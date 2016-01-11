import Promise from 'bluebird';
import path from 'path';
import fs from 'fs';
import tls from 'tls';
import { STATUS_CODES } from 'http';
import KnownError from '../util/knownError.js';
import aps from '../aps/aps.js';
import Service from './service.js';
import Resource from '../aps/resource.js';
import ConfigValidator from '../util/configValidator.js';
import { Logger, LogEmitter } from '../util/logger.js';
import { Incoming, Outgoing } from './message.js';
import util from '../util/util.js';

Promise.promisifyAll(fs);

const LOG_NAME = 'instance.log',
  CONFIG_NAME = 'config.json',
  CONFIG_INDENT = 2,
  SELF_CERT_NAME = 'instance.crt',
  SELF_KEY_NAME = 'instance.key',
  APSC_CERT_NAME = 'apsc.crt',
  HOME_MODE = 0o700,
  KEY_MODE = 0o600,
  CERT_MODE = KEY_MODE,
  CONFIG_MODE = 0o644,
  LOG_MODE = KEY_MODE,
  HTTP_CODES = {
    GENERAL_ERROR: 500,
    CERT_ERROR: 403,
    NO_CONTENT: 204
  },
  REQUEST_ID_CHARS = 6,
  configValidators = {
    'logLevel': ['log level', v => {
      if (!util.isNonEmptyString(v))
        return;
      v = v.toUpperCase();
      return LogEmitter.isLevelName(v) ? v : undefined;
    }],
    'checkCertificate': ['sertificate checking', v => util.isBoolean(v) ? v : undefined]
  };

export default class Instance {
  constructor(id, home, selfCert, selfKey, apscCert) {
    if (!Instance.isId(id))
      throw new Error('\'id\' must be an instance ID');
    if (!(util.isNonEmptyString(home) && (path.isAbsolute(home))))
      throw new Error('\'home\' must be an absolute path');
    this.logEmitter = new LogEmitter();
    this.id = id;
    this.home = home;
    if (arguments.length > 2) {
      if (!(util.isNonEmptyString(selfCert)))
        throw new Error('\'selfCert\' must be a non-empty string');
      if (!(util.isNonEmptyString(selfKey)))
        throw new Error('\'selfKey\' must be a non-empty string');
      if (!(util.isNonEmptyString(apscCert)))
        throw new Error('\'apscCert\' must be a non-empty string');
      try {
        tls.createSecureContext({
          cert: selfCert,
          key: selfKey
        });
      } catch(err) {
        throw new Error(`Failed to use provided instance TLS credentials: ${err.message}`);
      }
      let context;
      try {
        context = tls.createSecureContext({
          cert: apscCert
        }).context;
      } catch(err) {
        throw new Error(`Failed to use provided APSC TLS certificate: ${err.message}`);
      }
      this.apscCertRaw = context.getCertificate();
      this._create(selfCert, selfKey, apscCert);
    } else
      this._load();
    this.started.then(() => {
      this.context = Service.createContext();
    }).catch(reason => {
      const message = `Failed to ${this.initialized.isFulfilled() ? 'start' : 'initialize'}: ${KnownError.stringify(reason)}`;
      this.logEmitter.error(message);
      if (('logger' in this) && (this.logger.isReady())) {
        this.logger.critical(message);
        this.logger.close();
      }
    });
  }

  _create(selfCert, selfKey, apscCert) {
    const l = this.logEmitter;
    this.selfCert = selfCert;
    this.selfKey = selfKey;
    this.apscCert = apscCert;
    l.info('Initializing...', true);
    l.info(`Creating home directory: '${this.home}'...`, true);
    this.initialized = fs.mkdirAsync(this.home, HOME_MODE).then(() => {
      l.debug('Home directory created!');
      const logPath = this._getAssetPath(LOG_NAME),
        selfCertPath = this._getAssetPath(SELF_CERT_NAME),
        selfKeyPath = this._getAssetPath(SELF_KEY_NAME),
        apscCertPath = this._getAssetPath(APSC_CERT_NAME),
        configPath = this._getAssetPath(CONFIG_NAME),
        config = {},
        l1 = this.logger = new Logger(logPath, LOG_MODE),
        encoding = 'utf-8';
      for (let key in configValidators)
        config[key] = this[key];
      ConfigValidator.logConfig(l, configValidators, this);
      l.info(`Setting log level to '${this.logLevel}'...`);
      l1.level = Logger[this.logLevel];
      l.info(`Opening log file: '${logPath}'...`);
      l.info(`Saving instance TLS certificate to file: '${selfCertPath}'...`);
      l.info(`Saving instance TLS key to file: '${selfKeyPath}'...`);
      l.info(`Saving APSC TLS certificate to file: '${apscCertPath}'...`);
      l.info(`Writing default configuration to file: '${configPath}'...`);
      return Promise.join(this.logger.ready.then(() => {
        l.info('Log file was opened! It will now be used as primary log destination.');
        l1.info('Initializing...');
        ConfigValidator.logConfig(l1, configValidators, this);
      }, reason => {
        throw new KnownError(`Failed to open log file: ${reason.message}`);
      }), fs.writeFileAsync(selfCertPath, selfCert, {
        encoding,
        mode: CERT_MODE
      }).then(text => {
        l.debug(`Instance TLS certificate was saved successfully!`);
      }, reason => {
        throw new KnownError(`Failed to write instance TLS certificate to file: ${reason.message}`);
      }), fs.writeFileAsync(selfKeyPath, selfKey, {
        encoding,
        mode: KEY_MODE
      }).then(text => {
        l.debug(`Instance TLS key was saved successfully!`);
      }, reason => {
        throw new KnownError(`Failed to write instance TLS key to file: ${reason.message}`);
      }), fs.writeFileAsync(apscCertPath, apscCert, {
        encoding,
        mode: CERT_MODE
      }).then(text => {
        l.debug(`APSC TLS certificate was saved successfully!`);
      }, reason => {
        throw new KnownError(`Failed to write APSC TLS certificate to file: ${reason.message}`);
      }), fs.writeFileAsync(configPath, JSON.stringify(config, null, CONFIG_INDENT), {
        encoding,
        mode: CERT_MODE
      }).then(text => {
        l.debug(`Configuration file was written successfully!`);
      }, reason => {
        throw new KnownError(`Failed to write configuration to file: ${reason.message}`);
      }));
    }, reason => {
      throw new KnownError(`Failed to create home directory: ${reason.message}`);
    }).then(() => {
      const message = 'Initialized successfully!';
      this.logger.info(message);
      this.logEmitter.info(message);
    });
    this.started = this.initialized.then(() => {
      const message = 'Started successfully!';
      this.logger.info(message);
      this.logEmitter.info(message);
    });
  }

  _load() {
    const l = this.logEmitter,
      homePath = this.home;
    l.info('Initializing...', true);
    l.info(`Checking home directory: '${homePath}'...`, true);
    this.initialized = fs.statAsync(homePath).then(stat => {
      if (!stat.isDirectory())
        throw new KnownError(`Object at home directory path is not a directory`);
      l.debug('Home directory was checked successfully!');
      const logPath = this._getAssetPath(LOG_NAME),
        selfCertPath = this._getAssetPath(SELF_CERT_NAME),
        selfKeyPath = this._getAssetPath(SELF_KEY_NAME),
        apscCertPath = this._getAssetPath(APSC_CERT_NAME),
        configPath = this._getAssetPath(CONFIG_NAME),
        l1 = this.logger = new Logger(logPath, LOG_MODE),
        encoding = 'utf-8';
      l.info(`Opening log file: '${logPath}'...`);
      l.info(`Reading instance TLS certificate file: '${selfCertPath}'...`);
      l.info(`Reading instance TLS key file: '${selfKeyPath}'...`);
      l.info(`Reading APSC TLS certificate file: '${apscCertPath}'...`);
      l.info(`Reading configuration file: '${configPath}'...`);
      return Promise.join(this.logger.ready.then(() => {
        l.info('Log file was opened! It will now be used as primary log destination.');
        l1.info('Initializing...');
      }, reason => {
        throw new KnownError(`Failed to open log file: ${reason.message}`);
      }), Promise.join(fs.readFileAsync(selfCertPath, encoding).then(text => {
        l.debug(`Instance TLS certificate was read successfully!`);
        return text;
      }, reason => {
        throw new KnownError(`Failed to read instance TLS certificate file: ${reason.message}`);
      }), fs.readFileAsync(selfKeyPath, encoding).then(text => {
        l.debug(`Instance TLS key was read successfully!`);
        return text;
      }, reason => {
        throw new KnownError(`Failed to read instance TLS key file: ${reason.message}`);
      })).spread((selfCert, selfKey) => {
        l.debug('Validating instance TLS certificate and key files contents...');
        try {
          tls.createSecureContext({
            key: selfKey,
            cert: selfCert
          });
        } catch(err) {
          throw new KnownError(`Failed to validate instance TLS certificate and key files contents`);
        }
        this.selfCert = selfCert;
        this.selfKey = selfKey;
        l.debug('Instance TLS certificate and key files contents were validated successfully!');
      }), fs.readFileAsync(apscCertPath, encoding).then(text => {
        l.debug(`APSC TLS certificate was read successfully!`);
        l.debug('Validating APSC TLS certificate file contents...');
        let context;
        try {
          context = tls.createSecureContext({
            cert: text
          }).context;
        } catch(err) {
          throw new KnownError(`Failed to validate APSC TLS certificate file contents`);
        }
        this.apscCert = text;
        this.apscCertRaw = context.getCertificate();
        l.debug('APSC TLS certificate file contents were validated successfully!');
      }, reason => {
        throw new KnownError(`Failed to read APSC TLS certificate file: ${reason.message}`);
      }), fs.readFileAsync(configPath, encoding).then(text => {
        l.debug('Configuration file was read successfully');
        l.trace(`Configuration file contents:\n${text}`);
        l.debug('Parsing configuration file contents...');
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          throw new KnownError(`Failed to parse configuration file contents: ${err.message}`);
        }
        l.debug('Configuration file was parsed successfully!');
        l.trace(`Configuration file representation:\n${util.stringify(parsed)}`);
        const custom = parsed;
        let defaults = {};
        for (let v of Object.keys(configValidators))
          defaults[v] = this[v];
        const validator = new ConfigValidator(defaults, custom);
        validator.logEmitter.pipe(l);
        const config = validator.validate(configValidators);
        validator.logEmitter.unpipe(l);
        Object.assign(this, config);
        l.info(`Setting log level to '${this.logLevel}'...`);
        l1.level = Logger[this.logLevel];
      }, reason => {
        throw new KnownError(`Failed to read configuration file: ${reason.message}`);
      }));
    }, reason => {
      throw new KnownError(`Failed to check home directory: ${reason.message}`);
    }).then(() => {
      const l = this.logger;
      l.info(`Instance ID: '${this.id}'.`);
      l.info(`Home directory: '${this.home}'.`);
      ConfigValidator.logConfig(l, configValidators, this);
      const message = 'Initialized successfully!';
      l.info(message);
      this.logEmitter.info(message);
    });
    this.started = this.initialized.then(() => {
      const message = 'Started successfully!';
      this.logger.info(message);
      this.logEmitter.info(message);
    });
  }

  destroy() {

  }

  static isId(string) {
    return aps.isResourceId(string);
  }

  _getAssetPath() {
    return path.resolve(this.home, ...arguments);
  };

  getHelper(incoming) {
    if (!this.started.isFulfilled())
      throw new Error('Not ready to construct APS helper');
    if ((incoming !== undefined) && !(incoming instanceof Incoming))
      throw new TypeError('\'incoming\' must be an instance of \'Incoming\'');
    const helper = {
      Logger,
      LogEmitter,
      Promise,
      incoming,
      instanceId: this.id,
      logger: new LogEmitter()
    };
    helper.logger.pipe(this.logger);
    return helper;
  }

  handleRequest(service, incoming, outgoing, id) {
    if (!this.started.isFulfilled())
      throw new Error('Not ready to process the request');
    if (!(service instanceof Service))
      throw new TypeError('\'service\' must be an instance of \'Service\'');
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
      l.info(`A request with ID: '${id}' was passed. Processing...`);
    const rl = l.pushPrefix(`[R:${id}]`);
    incoming.ready.finally(() => {
      rl.trace(`Request dump:\n${incoming.dump(true)}`);
    });
    outgoing.handled.finally(() => {
      rl.trace(`Response dump:\n${outgoing.dump(true)}`);
    });
    outgoing.handled.then(() => {
      l.info(`Request with ID: '${id}' was handled. Code: ${outgoing.code} (${STATUS_CODES[outgoing.code]}), time elapsed: ${incoming.elapsed(outgoing)} seconds.`);
    }, reason => {
      rl.error(`Failed to handle due to unknown error: ${reason.stack}`);
    });
    if (this.checkCertificate) {
      const cert = incoming.certificate;
      if (cert === undefined) {
        httpError = new Error('No client certificate was provided!');
        rl.debug(httpError.message);
        httpError.code = outgoing.code = HTTP_CODES.CERT_ERROR;
        outgoing.end(httpError);
        return;
      }
      if (this.apscCertRaw.compare(cert.raw)) {
        httpError = new Error('Provided certificate does not match saved APSC certificate!');
        rl.debug(httpError.message);
        httpError.code = outgoing.code = HTTP_CODES.CERT_ERROR;
        outgoing.end(httpError);
        return;
      }
    }
    //cut off for proper request handling
    const method = incoming.method,
      methodId = method.toLowerCase();
    let httpError,
      constructor;

        rl.info(util.inspect(incoming._http.socket.getPeerCertificate().raw.toString('base64')));
    try {
      constructor = service.run(this.context, this.getHelper(incoming)).exports;
    } catch(err) {
      rl.error(`Error encountered while running service code: ${err.stack}`);
      httpError = new Error(`Unexpected error while running service code: ${err.message}`);
      httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
      outgoing.end(httpError);
      return;
    }
    if (typeof constructor !== 'function') {
      httpError = new Error('Service code did not export a constructor');
      rl.error(httpError.message);
      httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
      outgoing.end(httpError);
      return;
    }
    if (methodId === 'post') {
      incoming.ready.then(() => {
        try {
          incoming.parseBody();
        } catch(err) {
          httpError = new Error(`Unable to parse request body: ${err.message}`);
          rl.debug(httpError.message);
          httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
          outgoing.end(httpError);
          return;
        }
        let resource;
        try {
          resource = Resource.create(incoming.bodyObject, constructor);
        } catch(err) {
          rl.error(`Error encountered while constructing a resource: ${err.stack}`);
          httpError = new Error(`Unexpected error while constructing a resource: ${err.message}`);
          httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
          outgoing.end(httpError);
          return;
        }
        if ('provision' in resource) {
          if (typeof resource.provision === 'function') {
            let result;
            try {
              result = resource.provision();
            } catch(err) {
              httpError = new Error(`Error while provisioning: ${err.message}`);
              rl.error(`Error while provisioning: ${err.stack}`);
              httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
              outgoing.end(httpError);
              return;
            }
            if (typeof result.then === 'function') {
              rl.debug('Provisioning function has returned a .then\'able (promise)...');
              try {
                result.then(() => {
                  rl.debug('Provisioning promise has been resolved!');
                  outgoing.end(JSON.stringify(resource));
                }, reason => {
                  httpError = new Error(`Provisioning promise has been rejected: ${err.message}`);
                  rl.error(`Provisioning promise has been rejected: ${err.stack}`);
                  httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
                  outgoing.end(httpError);
                });
              } catch(err) {
                httpError = new Error(`Failed to attach to the provisioning promise: ${err.message}`);
                rl.error(`PFailed to attach to the provisioning promise: ${err.stack}`);
                httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
                outgoing.end(httpError);
              }
            } else {
              rl.debug('Provisioning function has completed successfully!');
              outgoing.end(JSON.stringify(resource));
            }
          } else {
            httpError = new Error('Value of \'provision\' field is not a function');
            rl.error(httpError.message);
            httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
            outgoing.end(httpError);
            return;
          }
        } else {
          rl.debug('No provisioning function found!');
          outgoing.end(JSON.stringify(incoming.bodyObject));
        }
      });
    } else if (methodId === 'put') {
      incoming.ready.then(() => {
        try {
          incoming.parseBody();
        } catch(err) {
          httpError = new Error(`Unable to parse request body: ${err.message}`);
          rl.debug(httpError.message);
          httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
          outgoing.end(httpError);
          return;
        }
        let resource;
        try {
          resource = Resource.create(incoming.bodyObject, constructor);
        } catch(err) {
          rl.error(`Error encountered while constructing a resource: ${err.stack}`);
          httpError = new Error(`Unexpected error while constructing a resource: ${err.message}`);
          httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
          outgoing.end(httpError);
          return;
        }
        if ('configure' in resource) {
          if (typeof resource.configure === 'function') {
            let result;
            try {
              result = resource.configure(resource);
            } catch(err) {
              httpError = new Error(`Error while configuring: ${err.message}`);
              rl.error(`Error while configuring: ${err.stack}`);
              httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
              outgoing.end(httpError);
              return;
            }
            if (typeof result.then === 'function') {
              rl.debug('Configuration function has returned a .then\'able (promise)...');
              try {
                result.then(() => {
                  rl.debug('Configuration promise has been resolved!');
                  outgoing.end(JSON.stringify(resource));
                }, reason => {
                  httpError = new Error(`Configuration promise has been rejected: ${err.message}`);
                  rl.error(`Configuration promise has been rejected: ${err.stack}`);
                  httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
                  outgoing.end(httpError);
                });
              } catch(err) {
                httpError = new Error(`Failed to attach to the configuration promise: ${err.message}`);
                rl.error(`PFailed to attach to the configuration promise: ${err.stack}`);
                httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
                outgoing.end(httpError);
              }
            } else {
              rl.debug('Configuration function has completed successfully!');
              outgoing.end(JSON.stringify(resource));
            }
          } else {
            httpError = new Error('Value of \'configure\' field is not a function');
            rl.error(httpError.message);
            httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
            outgoing.end(httpError);
            return;
          }
        } else {
          rl.debug('No configuration function found!');
          outgoing.end(JSON.stringify(incoming.bodyObject));
        }
      });
    } else if (methodId === 'delete') {
      let resource;
      try {
        resource = Resource.create(incoming.bodyObject, constructor);
      } catch(err) {
        rl.error(`Error encountered while constructing a resource: ${err.stack}`);
        httpError = new Error(`Unexpected error while constructing a resource: ${err.message}`);
        httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
        outgoing.end(httpError);
        return;
      }
      if ('unprovision' in resource) {
        if (typeof resource.unprovision === 'function') {
          let result;
          try {
            result = resource.unprovision();
          } catch(err) {
            httpError = new Error(`Error while unprovisioning: ${err.message}`);
            rl.error(`Error while Unprovisioning: ${err.stack}`);
            httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
            outgoing.end(httpError);
            return;
          }
          if (typeof result.then === 'function') {
            rl.debug('Unprovisioning function has returned a .then\'able (promise)...');
            try {
              result.then(() => {
                rl.debug('Unprovisioning promise has been resolved!');
                outgoing.code = HTTP_CODES.NO_CONTENT;
                outgoing.end();
              }, reason => {
                httpError = new Error(`Unprovisioning promise has been rejected: ${err.message}`);
                rl.error(`Unprovisioning promise has been rejected: ${err.stack}`);
                httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
                outgoing.end(httpError);
              });
            } catch (err) {
              httpError = new Error(`Failed to attach to the unprovisioning promise: ${err.message}`);
              rl.error(`PFailed to attach to the unprovisioning promise: ${err.stack}`);
              httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
              outgoing.end(httpError);
            }
          } else {
            rl.debug('Unprovisioning function has completed successfully!');
            outgoing.code = HTTP_CODES.NO_CONTENT;
            outgoing.end();
          }
        } else {
          httpError = new Error('Value of \'unprovision\' field is not a function');
          rl.error(httpError.message);
          httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
          outgoing.end(httpError);
          return;
        }
      } else {
        rl.debug('No unprovisioning function found!');
        outgoing.code =  HTTP_CODES.NO_CONTENT;
        outgoing.end(JSON.stringify(incoming.bodyObject));
      }
    } else {
      httpError = new Error(`Unsupported HTTP method: '${method}'`);
      rl.debug(httpError.message);
      httpError.code = outgoing.code = HTTP_CODES.GENERAL_ERROR;
      outgoing.end(httpError);
      return;
    }
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

  static set defaultCheckCertificate(flag) {
    this.prototype.checkCertificate = !!flag;
  }

  static get defaultCheckCertificate() {
    return this.prototype.checkCertificate;
  }
}

Instance.defaultLogLevel = 'TRACE';
Instance.defaultCheckCertificate = true;
