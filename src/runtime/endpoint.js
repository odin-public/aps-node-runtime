import Promise from 'bluebird';
import EventEmitter from 'events';
import child_process from 'child_process';
import path from 'path';
import fs from 'fs';
import c from '../util/constants.js';
import KnownError from '../util/knownError.js';
import { LogEmitter } from '../util/logger.js';
import ConfigValidator from '../util/configValidator.js';
import util from '../util/util.js';

Promise.promisifyAll(fs);

export default class Endpoint extends EventEmitter {
  constructor(configPath) {
    if ((typeof configPath !== 'string') || !configPath)
      throw new TypeError('\'path\' argument must be a non-empty string');
    super();
    const l = this.logger = new LogEmitter();
    this.configPath = configPath;
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
      const custom = parsed,
        defaults = Object.assign({}, c.ENDPOINT_CONFIG);
      defaults.name = path.basename(configPath, path.extname(configPath));
      defaults.ip = Endpoint.defaultIP;
      defaults.port = Endpoint.defaultPort;
      defaults.hostname = Endpoint.defaultHostname;
      const cv = new ConfigValidator(defaults, custom);
      cv.logger.pipe(l);
      let config = cv.validate({
        'name': ['name', v => Endpoint.isName(v) ? v : undefined],
        'ip': ['IP address', v => util.isIPv4(v) ? v : undefined],
        'port': ['port', v => util.isPort(v) ? v : undefined],
        'hostname': ['hostname', v => ((v === null) || util.isHostname(v)) ? v.toLowerCase() : undefined]
      });
      cv.logger.unpipe(l);
      if (!Endpoint.isName(config.name)) {
        throw new KnownError(`No valid name found. Candidates: '${defaults.name}'${custom.name ? ', \'' + custom.name + '\'' : ''}`);
      }
      return this;
    }, reason => {
      throw new KnownError(`Failed to read main configuration file: ${reason.message}!`);
    });
    this.started = this.initialized.then(() => {
      
    });
    this.started.catch(reason => {
      let message;
      if (reason instanceof KnownError)
        message = reason.message;
      else if (reason instanceof Error)
        message = reason.stack;
      else
        message = util.stringify(reason);
      l.error(`Failed to ${this.initialized.isRejected() ? 'initialize' : 'start'}: ${message}`);
    });
  }

  static isName(name) {
    return /^[a-z0-9-_]+$/i.test(name);
  }
}
