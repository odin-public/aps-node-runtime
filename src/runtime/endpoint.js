import Promise from 'bluebird';
import EventEmitter from 'events';
import path from 'path';
import os from 'os';
import fs from 'fs';
import dns from 'dns';
import net from 'net';
import KnownError from '../util/knownError.js';
import { Logger, LogEmitter } from '../util/logger.js';
import ConfigValidator from '../util/configValidator.js';
import TypeCache from './typeCache.js';
import aps from '../aps/aps.js';
import { STATUS_CODES } from 'http';
import Service from './service.js';
import { Incoming, Outgoing } from './message.js';
import Instance from './instance.js';
import util from '../util/util.js';

Promise.promisifyAll(fs);
Promise.promisifyAll(dns);

const META_DIR_NAME = 'aps',
  META_DIR_MODE = 0o700,
  LOG_NAME = 'endpoint.log',
  TYPE_CACHE_NAME = 'types.json',
  TYPE_CACHE_MODE = 0o644,
  RSA_KEY_START = '-----BEGIN RSA PRIVATE KEY-----',
  DEFAULT_SERVICE_CODE_SUFFIX = '.js',
  HTTP_CODES = {
    NOT_READY: 503,
    GENERAL_ERROR: 500,
    SERVICE_NOT_FOUND: 404,
    INSTANCE_NOT_FOUND: 404
  },
  REQUEST_ID_CHARS = 6,
  configValidators = {
    'host': ['host identifier', v => (net.isIPv4(v) || util.isHostname(v)) ? v : undefined],
    'port': ['port number', v => util.isPort(v) ? v : undefined],
    'virtualHost': ['virtual host', v => ((v === null) || (net.isIPv4(v) || util.isHostname(v))) ? v.toLowerCase() : undefined],
    'name': ['name', v => Endpoint.isName(v) ? v : undefined],
    'home': ['home directory', v => util.isNonEmptyString(v) ? (path.isAbsolute(v) ? v : path.resolve(Endpoint.relativeHomeRoot, v)) : undefined],
    'services': ['services definition', v => {
      let normalized = {};
      if (Array.isArray(v)) {
        if (!v.every(v1 => {
          if (aps.isServiceId(v1)) {
            normalized[v1] = v1 + DEFAULT_SERVICE_CODE_SUFFIX;
            return true;
          }
        }))
        return;
      } else if (util.isObject(v)) {
        for (let k in v) {
          if (!aps.isServiceId(k))
            return;
          let v1 = v[k];
          if (typeof v1 === 'string' && v1.length > 0) {
            v1 = path.parse(v1);
            if ((v1.root.length > 0) || (v1.dir.length > 0))
              return;
            else
              normalized[k] = v1.base + (v1.ext.length > 0 ? '' : DEFAULT_SERVICE_CODE_SUFFIX);
          } else
            normalized[k] = k + DEFAULT_SERVICE_CODE_SUFFIX;
        }
      }
      let seen = [];
      for (let k in normalized) {
        const v = normalized[k];
        if (seen.indexOf(v) !== -1)
          return;
        seen.push(v);
      }
      return normalized;
    }],
    'logLevel': ['log level', v => {
      if (!util.isNonEmptyString(v))
        return;
      v = v.toUpperCase();
      return LogEmitter.isLevelName(v) ? v : undefined;
    }],
    'useBabel': ['babel usage', v => util.isBoolean(v) ? v : undefined],
    'dummy': ['dummy mode', v => util.isBoolean(v) ? v : undefined]
  };

export default class Endpoint extends EventEmitter {
  constructor(configPath) {
    if (!util.isNonEmptyString(configPath))
      throw new TypeError('\'configPath\' argument must be a non-empty string');
    super();
    const l = this.logEmitter = new LogEmitter(),
      configName = path.parse(configPath).name;
    this.configPath = configPath;
    l.info('Initializing...', true);
    l.info(`Reading configuration file: '${configPath}'`, true);
    this.initialized = fs.readFileAsync(configPath, 'utf-8').then(text => {
      l.debug('Configuration file was read successfully');
      l.trace(`Configuration file contents:\n${text}`);
      l.debug('Parsing configuration file contents...');
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        throw new KnownError(`Failed to parse configuration file contents: ${e.message}`);
      }
      l.debug('Configuration file was parsed successfully!');
      l.trace(`Configuration file representation:\n${util.stringify(parsed)}`);
      const custom = parsed;
      let defaults = {};
      for (let v of ['host', 'port', 'virtualHost', 'logLevel', 'useBabel', 'dummy'])
        defaults[v] = this[v];
      defaults.name = configValidators.name[1](configName);
      defaults.home = configValidators.home[1](configName);
      const validator = new ConfigValidator(defaults, custom);
      validator.logEmitter.pipe(l);
      const config = validator.validate(configValidators);
      validator.logEmitter.unpipe(l);
      if (!Endpoint.isName(config.name))
        throw new KnownError(`No valid name could be selected. Candidates: ${'name' in custom ? '\'' + custom.name + '\', ' : ''}'${defaults.name}'`);
      if (!util.isNonEmptyString(config.home))
        throw new KnownError(`No valid home directory could be selected. Candidates: ${'home' in custom ? '\'' + custom.home + '\', ' : ''}'${defaults.home}'`);
      if (!config.services)
        throw new KnownError(`Services definition could not be parsed`);
      Object.assign(this, config);
      l.info(`Initialized successfully! Key: '${this.key}'.`);
      return this;
    }, reason => {
      throw new KnownError('Failed to read configuration file');
    });
    this.started = Promise.join(this.initialized, new Promise(resolve => {
      this.start = function start() {
        resolve();
        return this.started;
      };
    })).then(() => {
      this._getAssetPath = function() {
        return path.resolve(this.home, ...arguments);
      };
      const homePath = this.home;
      l.info('Starting...');
      l.info(`Checking if home directory exists: '${homePath}'...`);
      return fs.statAsync(homePath).then(stat => {
        if (!stat.isDirectory())
          throw new KnownError(`Object at home directory path is not a directory`);
        l.debug('Home directory was checked successfully!');
      }, reason => {
        throw new KnownError(`Failed to check home directory: ${reason.message}`);
      });
    }).then(() => {
      const metaPath = this._getAssetPath(META_DIR_NAME);
      l.info(`Listing metadata directory: '${metaPath}'...`);
      return fs.readdirAsync(metaPath).then(listing => {
        l.debug('Metadata directory was listed successfully!');
        if (listing.length > 0) {
          l.trace(`Metadata directory listing: '${listing.join('\', \'')}'`);
          l.debug(`Filtering metadata directory listing for entries that match APS instance IDs...`);
          return listing.filter(name => Instance.isId(name));
        } else {
          l.trace('Metadata directory is empty!');
          return listing;
        }
      }, reason => {
        if (reason.code === 'ENOENT') {
          l.warning('Metadata directory does not exist. Creating...');
          return fs.mkdirAsync(metaPath, META_DIR_MODE).then(() => {
            l.debug('Metadata directory created!');
            return null;
          }, reason => {
            throw new KnownError(`Failed to create metadata directory: ${reason.message}`);
          });
        } else
          throw new KnownError(`Failed to list metadata directory: ${reason.message}`);
      });
    }).then(instances => {
      const logPath = this._getAssetPath(META_DIR_NAME, LOG_NAME);
      l.info(`Opening log file: '${logPath}'...`);
      const l1 = this.logger = new Logger(logPath);
      l.info(`Setting log level to '${this.logLevel}'...`);
      l1.level = Logger[this.logLevel];
      return Promise.join(instances, this.logger.ready.then(() => {
        l.info('Log file was opened! It will now be used as primary log destination.');
        l1.info('Starting...');
        l1.info(`Configuration file path: '${this.configPath}'`);
        ConfigValidator.logConfig(l1, configValidators, this);
        l1.info(`Endpoint key: '${this.key}'`);
      }, reason => {
        throw new KnownError(`Failed to open log file: ${reason.message}`);
      }));
    }).spread(instances => {
      const l = this.logger,
        typesPath = this._getAssetPath(META_DIR_NAME, TYPE_CACHE_NAME);
      let typeCache;
      this.instances = new Map();
      if (instances === null) {
        l.info('No instances will be created (metadata directory did not exist)!');
        typeCache = Promise.reject(new KnownError('Metadata directory did not exist'));
      } else {
        if (instances.length > 0) {
          instances.forEach(id => this.instances.set(id));
          l.info(`Will attempt to load instances for the following IDs: '${instances.join('\', \'')}'`);
        } else {
          l.info('No instances will be created (no matching entries were found in metadata directory)!');
        }
        l.info(`Reading type cache file: '${typesPath}'...`);
        typeCache = fs.readFileAsync(typesPath, 'utf-8').then(text => {
          l.debug('Type cache file was read successfully!');
          l.debug('Parsing type cache file contents...');
          let result,
            types;
          try {
            let types = JSON.parse(text);
          } catch (e) {
            throw new KnownError(`Failed to parse type cache file contents: ${e.message}`);
          }
          l.debug('Type cache file contents were parsed successfully!');
          l.debug('Constructing type cache...');
          try {
            result = new TypeCache(types);
          } catch (e) {
            throw new KnownError(`Failed to construct type cache: ${e.message}`);
          }
          l.debug('Type cache constructed successfully!');
          return result;
        }, reason => {
          throw new KnownError(`Failed to read type cache file: ${reason.message}`);
        });
      }
      l.info(`Reading service code files from home directory: '${this.home}'...`);
      const services = this.services,
        codeFiles = [],
        context = Service.createContext();
      this.services = new Map();
      for (let serviceId in services) {
        let filePath = this._getAssetPath(services[serviceId]);
        l.info(`Reading code file '${filePath}' for service '${serviceId}'...`);
        codeFiles.push(fs.readFileAsync(filePath, 'utf-8').then(text => {
          l.debug(`Code file for service with ID: '${serviceId}' was read successfully (size: ${util.humaneSize(Buffer.byteLength(text, 'utf-8'))})! Creating virtual machine...`);
          let service;
          try {
            service = new Service(filePath, text, this.useBabel);
          } catch (err) {
            if (err instanceof SyntaxError)
              throw new KnownError(`Syntax check failed for '${filePath}': ${err.message}!`);
            throw new KnownError(`Error when creating virtual machine for service with ID: ${err.stack}`);
          }
          l.debug(`Virtual machine for service with ID: '${serviceId}' was created successfully!`);
          l.debug(`Dry-running a VM for service with ID: '${serviceId}'...`);
          let result;
          try {
            result = service.run(context);
          } catch(err) {
            throw new KnownError(`Unknown error while performing a dry run on VM for service with ID: '${serviceId}': ${err.stack}`);
          }
          if (typeof result.exports !== 'function')
            throw new KnownError(`VM for service with ID: '${serviceId}' did not export a function`);
          l.debug(`Dry run on VM for service with ID: '${serviceId}' completed successfully!`);
          this.services.set(serviceId, service);
        }, reason => {
          throw new KnownError(`Failed to read code file '${filePath}': ${reason.message}`);
        }));
      }
      return Promise.join(typeCache.reflect(), Promise.all(codeFiles));
    }).spread(typeCache => {
      const l = this.logger;
      if (typeCache.isFulfilled()) {
        this.typeCache = typeCache.value();
        l.info(`Unsing type cache from file, ${util.pluralize('item', this.typeCache.size)}!`);
      } else {
        l.warning(`Using empty type cache: ${KnownError.stringify(typeCache.reason())}`);
        this.typeCache = new TypeCache();
      }
      l.info('Attempting to open type cache file for writing...');
      const typeCacheStream = fs.openAsync(this._getAssetPath(META_DIR_NAME, TYPE_CACHE_NAME), 'w', TYPE_CACHE_MODE).then(fd => {
        l.debug('Type cache file was opened successfully!');
        this.typesStream = fs.createWriteStream(null, {
          encoding: 'utf-8',
          fd
        });
      }, reason => {
        l.error(`Failed to open type cache file for writing: ${reason.message}. Only in-memory cache will be used!`);
      });
      const instanceStates = [],
        instances = this.instances;
      instances.forEach((v, id) => {
        const services = new Map();
        this.services.forEach((v, k) => {
          services.set(k, Object.assign({}, v));
        });
        const instance = new Instance(id, this._getAssetPath(META_DIR_NAME, id)),
          instancePrefix = l.pushPrefix(`[I:${id}]`);
        instance.logEmitter.pipe(instancePrefix);
        instance.started.catch(() => {
          instance.logEmitter.unpipe(instancePrefix);
        });
        l.info(`Created and attached an instance with ID: '${id}'!`);
        instances.set(id, instance);
        instanceStates.push(instance.started.reflect());
      });
      return Promise.join(typeCacheStream.reflect(), Promise.all(instanceStates).then(() => {
        l.info('Removing instances that failed to start...');
        const instances = this.instances;
        instances.forEach((instance, id) => {
          if (instance.started.isRejected()) {
            l.debug(`Removing instance with ID: '${id}'!`);
            instances.delete(id);
          }
        });
      })).then(() => {
        const active = [];
        instances.forEach((instance, id) => active.push(id));
        l.info(`Started successfully! ${active.length > 0 ? 'Loaded instances: \'' + active.join('\', \'') + '\'.' : 'No instances were loaded.'}`);
      });
    });
    this.started.catch(reason => {
      const message = `Failed to ${this.initialized.isFulfilled() ? 'start' : 'initialize'}: ${KnownError.stringify(reason)}`;
      l.error(message);
      if (('logger' in this) && (this.logger.isReady())) {
        this.logger.critical(message);
        this.logger.close();
      }
    });
  }

  static set defaultHost(host) {
    host = String(host);
    if (net.isIPv4(host) || util.isHostname(host))
      this.prototype.host = host;
    else
      throw new Error(`Not a valid host identifier: '${host}'`);
  }

  static get defaultHost() {
    return this.prototype.host;
  }

  static set defaultPort(port) {
    port = parseInt(port, 10);
    if (util.isPort(port))
      this.prototype.port = port;
    else
      throw new Error(`Not a valid port number: ${port}`);
  }

  static get defaultPort() {
    return this.prototype.port;
  }

  static set defaultVirtualHost(host) {
    if ((host === null) || util.isHostname(host = String(host).toLowerCase()))
      this.prototype.virtualHost = host;
    else
      throw new Error(`Not a valid host identifier (or null): '${host}'`);
  }

  static get defaultVirtualHost() {
    return this.prototype.virtualHost;
  }

  static set defaultLogLevel(levelName) {
    levelName = String(levelName).toUpperCase();
    if (LogEmitter.isLevelName(levelName))
      this.prototype.logLevel = levelName;
    else
      throw new Error(`Not a valid log level: '${levelName}'`);
  }

  static get defaultLogLevel() {
    return this.prototype.logLevel;
  }

  static set defaultDummy(flag) {
    this.prototype.dummy = !!flag;
  }

  static get defaultDummy() {
    return this.prototype.dummy;
  }

  static set defaultUseBabel(flag) {
    this.prototype.useBabel = !!flag;
  }

  static get defaultUseBabel() {
    return this.prototype.useBabel;
  }

  static set relativeHomeRoot(directoryPath) {
    directoryPath = String(directoryPath);
    if (path.isAbsolute(directoryPath))
      this._relativeHomeRoot = directoryPath;
    else
      throw new Error(`Not a valid absolute path: '${directoryPath}'`);
  }

  static get relativeHomeRoot() {
    return this._relativeHomeRoot;
  }

  static isName(string) {
    return /^[a-z0-9-_]+$/i.test(string);
  }

  static keysFromRequest(incoming) {
    if (!(incoming instanceof Incoming))
      throw new Error('\'incoming\' must be an instance of \'Incoming\'');
    if (!(('bodyObject' in incoming) && util.isObject(incoming.bodyObject)))
      throw new Error('Parsed request body is not available, call \'incoming.parseBody()\' first');
    let object = incoming.bodyObject;
    if (!('aps' in object))
      throw new Error('Body object does not contain resource metadata (key: \'aps\')');
    object = object.aps;
    if (!('x509' in object))
      throw new Error('Metadata object does not contain TLS credentials (key: \'x509\')');
    object = object.x509;
    if (!('self' in object))
      throw new Error('TLS credentials object does not contain instance data (key: \'self\')');
    if (!('controller' in object))
      throw new Error('TLS credentials object does not contain APSC data (key: \'controller\')');
    const { self, controller } = object,
      selfSplit = self.split(RSA_KEY_START);
    if (selfSplit.length <= 1)
      throw new Error('Instance TLS credentials do not contain private key');
    selfSplit[1] = RSA_KEY_START + selfSplit[1];
    return {
      selfCert: selfSplit[0],
      selfKey: selfSplit[1],
      apscCert: controller
    };
  }

  set key(key) {
    throw new Error('Endpoint key cannot be set directly');
  }

  get key() {
    return ('name' in this) ? `(${this.virtualHost || '*'})${this.host}:${this.port}/${this.name}` : '';
  }

  handleRequest(incoming, outgoing, id) {
    if (!this.started.isFulfilled())
      throw new Error('Not ready to process the request');
    if (!(incoming instanceof Incoming))
      throw new TypeError('\'incoming\' must be an instance of \'Incoming\'');
    if (!(outgoing instanceof Outgoing))
      throw new TypeError('\'outgoing\' must be an instance of \'Outgoing\'');
    const l = this.logger,
      peer = incoming.remoteAddress;
    if (id === undefined) {
      id = util.createUuid(REQUEST_ID_CHARS);
      l.info(`Incoming request from '${peer}', assigned ID: '${id}'...`);
    } else
      l.info(`Request with ID: '${id}' was passed. Processing...`);
    const rl = l.pushPrefix(`[R:${id}]`),
      instanceId = incoming.instance,
      serviceId = incoming.service;
    rl.debug(`Instance ID: '${instanceId}'.`);
    rl.debug(`Service ID: '${serviceId}'.`);
    outgoing.handled.then(() => {
      l.info(`Request with ID: '${id}' was handled. Code: ${outgoing.code} (${STATUS_CODES[outgoing.code]}), time elapsed: ${incoming.elapsed(outgoing)} seconds.`);
    }, reason => {
      rl.error(`Failed to handle due to unknown error: ${reason.stack}`);
    });
    const service = this.services.get(serviceId);
    if (service === undefined) {
      const httpError = new Error(`Service with ID: '${serviceId}' not found`);
      rl.debug(`Matching service not found!`);
      httpError.code = outgoing.code = HTTP_CODES.SERVICE_NOT_FOUND;
      outgoing.end(httpError);
      return;
    }
    rl.debug(`Mathing service found!`);
    let destination = this.instances.get(instanceId);
    if (destination !== undefined) {
      if (!destination.started.isFulfilled()) {
        rl.debug(`Matching instance found, but not started yet!`);
        const httpError = new Error(`Instance is not ready yet`);
        httpError.code = outgoing.code = HTTP_CODES.NOT_READY;
        outgoing.end(httpError);
        return;
      }
      rl.debug(`Matching instance found! Passing request...`);
      try {
        destination.handleRequest(service, incoming, outgoing, id);
      } catch(err) {
        rl.error(`Unknown error while trying to pass the request to instance: ${err.stack}`);
        const httpError = new Error(`Failed to pass request to instance: ${err.message}`);
        httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
        outgoing.end(httpError);
      }
      return;
    }
    rl.debug(`Matching instance not found! Checking if it can be created from request...`);
    let httpError = new Error(`Instance with ID: '${instanceId}' not found`);
    httpError.code = HTTP_CODES.INSTANCE_NOT_FOUND; 
    if (incoming.method.toLowerCase() === 'post') {
      incoming.ready.then(() => {
        try {
          incoming.parseBody();
        } catch(err) {
          rl.debug(`No instance will be created, error when parsing body: ${err.message}!`);
          httpError = new Error(`${httpError.message} and unable to parse request body`);
          httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
          outgoing.end(httpError);
          return;
        }
        let keys;
        try {
          keys = Endpoint.keysFromRequest(incoming);
        } catch(err) {
          rl.debug(`No instance will be created, unable to extract keys: ${err.message}`);
          httpError = new Error(`${httpError.message} and unable to extract keys from request body`);
          outgoing.end(httpError);
          return;
        }
        try {
          rl.debug('Attempting to create an instance...');
          destination = new Instance(instanceId, this._getAssetPath(META_DIR_NAME, instanceId), keys.selfCert, keys.selfKey, keys.apscCert);
          const instancePrefix = l.pushPrefix(`[I:${instanceId}]`);
          destination.logEmitter.pipe(instancePrefix);
          destination.started.catch(() => {
            destination.logEmitter.unpipe(instancePrefix);
          });
          const instances = this.instances,
            instanceIds = [];
          instances.set(instanceId, destination);
          l.info(`Instance with ID: '${instanceId}' was created from request with ID: '${id}'...`);
          l.debug(`Following instances are available: '${instanceIds.join('\', \'')}'`);
        } catch(err) {
          rl.error(`Failed to create instance: ${err.message}`);
          httpError = new Error(`${httpError.message} and unable to create instance due to unknown error: ${err.message}`);
          httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
          outgoing.end(httpError);
        }
        destination.started.then(() => {
          rl.debug(`Instance started successfully! Passing request...`);
          try {
            destination.handleRequest(service, incoming, outgoing, id);
          } catch(err) {
            rl.error(`Unknown error while trying to pass the request to instance: ${err.stack}`);
            httpError = new Error(`Failed to pass request to instance: ${err.message}`);
            httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
            outgoing.end(httpError);
          }
        }, reason => {
          rl.error(`Instance was unable to start: ${KnownError.stringify(reason)}`);
          httpError = new Error(`New instance failed to start: ${reason.message}`);
          httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
          outgoing.end(httpError);
        });
        return;
      }, reason => {
        rl.error(`No instance will be created, error when reading body: ${reason.message}!`);
        httpError = new Error(`${httpError.message} and unable to parse request body`);
        httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
        outgoing.end(httpError);
        return;
      });
    } else {
      rl.debug('No instance will be created, not a \'POST\' request!');
      outgoing.code = httpError.code;
      outgoing.end(httpError);
    }
  }

  stop() {
    this.started.finally(() => {
    });
  }
}

Endpoint.defaultHost = '0.0.0.0';
Endpoint.defaultPort = '443';
Endpoint.defaultVirtualHost = null;
Endpoint.defaultLogLevel = 'TRACE';
Endpoint.defaultUseBabel = true;
Endpoint.defaultDummy = false;
Endpoint.relativeHomeRoot = (process.platform  === 'win32' ? (process.env.SystemDrive || 'C:')  : '') + path.sep; // 'C:\' on proprietary crap, '/' on others
