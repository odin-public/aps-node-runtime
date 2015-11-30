import Promise from 'bluebird';
import EventEmitter from 'events';
import path from 'path';
import os from 'os';
import fs from 'fs';
import dns from 'dns';
import net from 'net';
import KnownError from '../util/knownError.js';
import { LogEmitter } from '../util/logger.js';
import ConfigValidator from '../util/configValidator.js';
import aps from '../aps/aps.js';
import util from '../util/util.js';

Promise.promisifyAll(fs);
Promise.promisifyAll(dns);

const DEFAULT_SERVICE_CODE_SUFFIX = '.js';

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
      const config = validator.validate({
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
      });
      validator.logEmitter.unpipe(l);
      if(!Endpoint.isName(config.name))
        throw new KnownError(`No valid name could be selected. Candidates: ${'name' in custom ? '\'' + custom.name + '\', ' : ''}'${defaults.name}'`);
      if(!util.isNonEmptyString(config.home))
        throw new KnownError(`No valid home directory could be selected. Candidates: ${'home' in custom ? '\'' + custom.home + '\', ' : ''}'${defaults.home}'`);
      if(!config.services)
        throw new KnownError(`Services definition could not be parsed`);
      Object.assign(this, config);
      l.debug(`Running NS lookup for main host identifier: '${this.host}'...`);
      return dns.lookupAsync(this.host, 4);
    }, reason => {
      throw new KnownError(`Failed to read main configuration file: ${reason.message}!`);
    }).then(address => {
      this.host = address;
      l.info(`Initialization finished successfully! Key: '${this.key}'.`);
      return this;
    }, reason => {
      throw new KnownError(`Unable to resolve main host identifier '${this.host}': ${reason.message}!`);
    });
    this.started = this.initialized.then(() => {
      l.info('Starting...');
      l.info('Started successfully!');
    });
    this.started.catch(reason => {
      let message;
      if (reason instanceof KnownError)
        message = reason.message;
      else if (reason instanceof Error)
        message = reason.stack;
      else
        message = util.stringify(reason);
      l.error(`Failed to ${this.initialized.isFulfilled() ? 'start' : 'initialize'}: ${message}`);
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

  }
}

Endpoint.defaultHost = '0.0.0.0';
Endpoint.defaultPort = '443';
Endpoint.defaultVirtualHost = null;
Endpoint.defaultLogLevel = 'TRACE';
Endpoint.defaultDummy = false;
Endpoint.relativeHomeRoot = (os.platform() === 'win32' ? (process.env.SystemDrive || 'C:' )  : '') + path.sep; // 'C:\' on proprietary crap, '/' on others
