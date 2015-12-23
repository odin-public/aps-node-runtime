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
import Instance from './instance.js';
import util from '../util/util.js';

Promise.promisifyAll(fs);
Promise.promisifyAll(dns);

const META_DIR_NAME = 'aps',
  META_DIR_MODE = 0o700,
  LOG_NAME = 'endpoint.log',
  TYPE_CACHE_NAME = 'types.json',
  TYPE_CACHE_MODE = 0o644,
  DEFAULT_SERVICE_CODE_SUFFIX = '.js',
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
      for (let v of ['host', 'port', 'virtualHost', 'logLevel', 'dummy'])
        defaults[v] = this[v];
      defaults.name = defaults.home = configName;
      const validator = new ConfigValidator(defaults, custom);
      validator.logEmitter.pipe(l);
      const config = validator.validate(configValidators);
      validator.logEmitter.unpipe(l);
      if(!Endpoint.isName(config.name))
        throw new KnownError(`No valid name could be selected. Candidates: ${'name' in custom ? '\'' + custom.name + '\', ' : ''}'${defaults.name}'`);
      if(!util.isNonEmptyString(config.home))
        throw new KnownError(`No valid home directory could be selected. Candidates: ${'home' in custom ? '\'' + custom.home + '\', ' : ''}'${defaults.home}'`);
      if(!config.services)
        throw new KnownError(`Services definition could not be parsed`);
      Object.assign(this, config);
      l.info(`Initialization finished successfully! Key: '${this.key}'.`);
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
        throw new KnownError(`Unable to check home directory: ${reason.message}`);
      });
    }).then(() => {
      const metaPath = this._getAssetPath(META_DIR_NAME);
      l.info(`Listing metadata directory: '${metaPath}'...`);
      return fs.readdirAsync(metaPath).then(listing => {
        l.debug('Metadata directory was listed successfully!');
        if (listing.length > 0) {
          l.trace(`Metadata directory listing: '${listing.join('\', \'')}'`);
          l.debug(`Filtering metadata directory listing for entries that match APS instance IDs...`);
          return listing.filter(v => aps.isResourceId(v));
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
        l.info('Log file was opened! It will now be used as a primary log destination.');
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
      } else {
        if (instances.length > 0) {
          instances.forEach(id => this.instances.set(id));
          l.info(`Will attempt to create instances for the following IDs: '${instances.join('\', \'')}'`);
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
          } catch(e) {
            throw new KnownError(`Failed to parse type cache file contents: ${e.message}`);
          }
          l.debug('Type cache file contents were parsed successfully!');
          l.debug('Constructing type cache...');
          try {
            result = new TypeCache(types);
          } catch(e) {
            throw new KnownError(`Failed to construct type cache: ${e.message}`);
          }
          l.debug('Type cache constructed successfully!');
          return result;
        }, reason => {
          throw new KnownError(`Failed to read type cache file: ${reason.message}`);
        }).reflect();
      }
      l.info(`Reading services code files from home directory: '${this.home}'...`);
      const services = this.services,
        codeFiles = [];
      this.services = new Map();
      for (let service in services) {
        let file = services[service];
        l.info(`Reading code file '${file}' for service '${service}'...`);
        codeFiles.push(fs.readFileAsync(this._getAssetPath(file)).then(text => {
          l.debug(`Code file '${file}' for service '${service}' was read successfully (size: ${util.humaneSize(Buffer.byteLength(text, 'utf-8'))})! Checking syntax...`);
          try {
            new Function(text);
          } catch(e) {
            throw new KnownError(`Syntax check failed for '${file}'!`);
          }
          l.debug(`Syntax check for '${file}' successful!`);
          this.services.set(service, {
            file,
            code: text
          });
        }, reason => {
          throw new KnownError(`Failed to read code file '${file}': ${reason.message}`);
        }));
      }
      return Promise.join(typeCache, Promise.all(codeFiles));
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
      }).reflect();
      const instanceStates = [],
        instances = this.instances;
      instances.forEach((v, id) => {
        const services = new Map();
        this.services.forEach((v, k) => {
          services.set(k, Object.assign({}, v));
        });
        const instance = new Instance(this._getAssetPath(META_DIR_NAME, id), this.home, services),
          instancePrefix = l.pushPrefix(`[I:${id}]`);
        instance.logEmitter.pipe(instancePrefix);
        instance.started.catch(() => {
          instance.logEmitter.unpipe(endpointPrefix);
        });
        l.info(`Created and attached an instance with ID: '${id}'!`);
        instances.set(id, instance);
        instanceStates.push(instance.started.reflect());
      });
      return Promise.join(typeCacheStream, Promise.all(instanceStates).then(() => {
        l.info('Removing instances that failed to start...');
        const instances = this.instances;
        instances.forEach((instance, id) => {
          if (instance.started.isRejected()) {
            l.debug(`Removing instance with ID: '${id}'!`);
            instances.delete(id);
          }
        });
      }));
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

  set key(key) {
    throw new Error('Endpoint key cannot be set directly');
  }

  get key() {
    return ('name' in this) ? `(${this.virtualHost || '*'})${this.host}:${this.port}/${this.name}` : '';
  }

  handleRequest(request) {

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
Endpoint.defaultDummy = false;
Endpoint.relativeHomeRoot = (os.platform() === 'win32' ? (process.env.SystemDrive || 'C:' )  : '') + path.sep; // 'C:\' on proprietary crap, '/' on others
