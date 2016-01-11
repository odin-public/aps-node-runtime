if (require.main !== module)
  throw new Error('This is the daemon for APS Node.js runtime, do not attempt to use it as a module');

import Promise from 'bluebird';
import fs from 'fs';
import path from 'path';
import net from 'net';
import tls from 'tls';
import util from './util/util.js';
import c from './util/constants.js';
import KnownError from './util/knownError.js';
import Logger from './util/logger.js';
import ConfigValidator from './util/configValidator.js';
import Router from './runtime/router.js';
import { Outgoing } from './runtime/message.js';
import Endpoint from './runtime/endpoint.js';
import Instance from './runtime/instance.js';

Promise.promisifyAll(fs);

c.DIR_PREFIX = path.isAbsolute(c.DIR_PREFIX) ? c.DIR_PREFIX : __dirname;

function getAssetPath() {
  return path.resolve(c.DIR_PREFIX, ...arguments);
}

const ENDPOINT_CONFIG_SUFFIX = '.json',
  LOG_NAME = 'aps-node.log',
  CONFIG_NAME = 'config.json',
  ENDPOINTS_DIR_NAME = 'endpoints',
  TLS_KEY_NAME = 'daemon.key',
  TLS_CERT_NAME = 'daemon.crt',
  EXIT_GENERAL_FAILURE = 1,
  l = new Logger(getAssetPath(c.LOG_DIR, LOG_NAME));

function send(message, type = 'error') {
  return process.connected ? process.send({
    type,
    message
  }) : undefined;
}

function exit(code) {
  l.unpause();
  l.close().then(() => process.exit(code));
}

process
  .on('uncaughtException', error => {
    if (l.isReady() !== false)
      l.critical(`Unhandled error: ${error.stack}`);
    send(error.stack);
    exit(EXIT_GENERAL_FAILURE);
  })
  .on('unhandledRejection', reason => {
    if (l.isReady() !== false)
      l.critical(`Unhandled error: ${util.isError(reason) ? reason.stack : reason}`);
    send(util.isError(reason) ? reason.stack : reason);
    exit(EXIT_GENERAL_FAILURE);
  });

process.send({
  type: 'config',
  logPath: l.path
});

l.pause();

l.ready
  .then(start, err => {
    send(`Unable to open main log: ${err.message}`);
    throw EXIT_GENERAL_FAILURE;
  })
  .catch(reason => {
    let message;
    if (reason instanceof KnownError) {
      send(reason.message);
      message = reason.message;
    } else if (reason instanceof Error) {
      send(reason.stack);
      message = `Unexpected error in main daemon code: ${reason.stack}`;
    } else {
      send(reason);
      message = `Caught unknown object from main daemon code: ${util.stringify(reason)}`;
    }
    l.critical(message);
    exit(EXIT_GENERAL_FAILURE);
  });

function start() {
  const configPath = getAssetPath(c.CONFIG_DIR, CONFIG_NAME),
    tlsKeyPath = getAssetPath(c.CONFIG_DIR, TLS_KEY_NAME),
    tlsCertPath = getAssetPath(c.CONFIG_DIR, TLS_CERT_NAME),
    endpointsPath = getAssetPath(c.CONFIG_DIR, ENDPOINTS_DIR_NAME);
  let router;
  l.info('Starting APS Node.js daemon!');
  l.info(`Reading main configuration file: '${configPath}'...`);
  l.info(`Reading main TLS private key file: '${tlsKeyPath}'...`);
  l.info(`Reading main TLS certificate file: '${tlsCertPath}'...`);
  l.info(`Listing endpoints directory: '${endpointsPath}'...`);
  return Promise.join(fs.readFileAsync(configPath, 'utf-8').then(text => {
    l.debug('Main configuration file was read successfully!');
    l.trace(`Main configuration file contents:\n${text}`);
    l.debug('Parsing main configuration file contents...');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      l.error(`Failed to parse main configuration file contents: ${e.message}`);
      throw null;
    }
    l.debug('Main configuration file contents were parsed successfully!');
    l.trace(`Main configuration file contents representation:\n${util.stringify(parsed)}`);
    return parsed;
  }, reason => {
    l.error(`Failed to read main configuration file: ${reason.message}!`);
    throw null;
  }).reflect().then(config => {
    l.debug('Computing main configuration...');
    let validator;
    if (config.isFulfilled()) {
      l.info('Using custom main configuration from file!');
      validator = new ConfigValidator(c.MAIN_CONFIG, config.value());
    } else {
      l.info('Unable to use main configuration file. Using default configuration!');
      validator = new ConfigValidator(c.MAIN_CONFIG);
    }
    validator.logEmitter.pipe(l);
    config = validator.validate({
      'logLevel': ['log level', v => {
        if (!util.isNonEmptyString(v))
          return;
        v = v.toUpperCase();
        return Logger.levelName(v) ? v : undefined;
      }],
      'defaultHost': ['default endpoint host identifier', v => (net.isIPv4(v) || util.isHostname(v)) ? v : undefined],
      'defaultPort': ['default endpoint port', v => {
        v = parseInt(v, 10);
        return util.isPort(v) ? v : undefined;
      }],
      'defaultVirtualHost': ['default endpoint virtual host', v => ((v === null) || (net.isIPv4(v) || util.isHostname(v))) ? v.toLowerCase() : undefined]
    });
    validator.logEmitter.unpipe(l);
    l.level = Logger[config.logLevel];
    l.unpause();
    return config;
  }), fs.readFileAsync(tlsKeyPath).then(text => {
    l.debug('Main TLS private key file was read successfully!');
    l.trace(`Main TLS private key file contents:\n${text}`);
    l.debug('Validating main TLS private key file contents...');
    try {
      tls.createSecureContext({
        key: text
      });
    } catch (e) {
      throw new KnownError(`Failed to validate main TLS private key file contents: ${e.message}!`);
    }
    l.debug('Main TLS private key file contents were validated successfully!');
    return text;
  }, reason => {
    throw new KnownError(`Failed to read main TLS private key file: ${reason.message}!`);
  }), fs.readFileAsync(tlsCertPath).then(text => {
    l.debug('Main TLS certificate file was read successfully!');
    l.trace(`Main TLS certificate file contents:\n${text}`);
    l.debug('Validating main TLS certificate file contents...');
    try {
      tls.createSecureContext({
        cert: text
      });
    } catch (e) {
      throw new KnownError(`Failed to validate main TLS certificate file contents: ${e.message}!`);
    }
    l.debug('Main TLS certificate file contents were validated successfully!');
    return text;
  }, reason => {
    throw new KnownError(`Failed to read main TLS certificate file: ${reason.message}!`);
  }), fs.readdirAsync(endpointsPath).then(listing => {
    l.debug('Endpoints directory was listed successfully!');
    if (listing.length === 0) {
      throw new KnownError(`Endpoints directory is empty. Nothing to do!`);
    } else {
      l.trace(`Endpoints directory listing: '${listing.join('\', \'')}'`);
      return listing;
    }
  }, reason => {
    throw new KnownError(`Failed to list endpoints directory: ${reason.message}`);
  }), (config, tlsKey, tlsCert, endpointsListing) => {
    l.info('Configuring components...');
    Endpoint.defaultHost = config.defaultHost;
    Endpoint.defaultPort = config.defaultPort;
    Endpoint.defaultVirtualHost = config.defaultVirtualHost;
    Endpoint.defaultLogLevel = c.ENDPOINT_CONFIG.logLevel;
    Endpoint.defaultDummy = c.ENDPOINT_CONFIG.dummy;
    Endpoint.relativeHomeRoot = getAssetPath(c.ENDPOINT_DIR);
    Instance.defaultLogLevel = c.INSTANCE_CONFIG.logLevel;
    Instance.defaultCheckCertificate = c.INSTANCE_CONFIG.checkCertificate;
    Outgoing.defaultHeaders['X-Powered-By'] = `APS Node.js Runtime v${c.VERSION}`;
    l.debug(`Selecting configuration files in the endpoints directory (*${ENDPOINT_CONFIG_SUFFIX})...`);
    const loggers = new Map(),
      endpoints = endpointsListing.filter(v => (v.length > ENDPOINT_CONFIG_SUFFIX.length) && v.endsWith(ENDPOINT_CONFIG_SUFFIX)); //no dotfiles
    if (endpoints.length === 0)
      throw new KnownError(`No endpoint configuration files found (*${ENDPOINT_CONFIG_SUFFIX}). Nothing to do!`);
    l.info(`Creating and passing control to the router with these endpoints: '${endpoints.join('\', \'')}'`);
    router = new Router(tlsKey, tlsCert, endpoints.map(v => new Endpoint(path.resolve(endpointsPath, v))));
    router.endpoints.forEach((v, k) => {
      const endpointPrefix = l.pushPrefix(`[E:${k}]`);
      v.logEmitter.pipe(endpointPrefix);
      v.started.catch(() => {
        v.logEmitter.unpipe(endpointPrefix);
      });
    });
    let privilegesDropped;
    if ('setuid' in process) {
      privilegesDropped = new Promise((resolve, reject) => {
        router.on('listening', () => {
          const id = c.IDENTITY;
          try {
            l.info(`Router is now listening. Switching privileges to: '${id}'...`);
            process.setgid(id);
            process.setegid(id);
            process.initgroups(id, id);
            process.setuid(id);
            process.seteuid(id);
            l.info(`Set original and effective user ID and group ID to: '${id}'!`);
            resolve();
          } catch (e) {
            reject(new KnownError(`Unable to switch privileges to: '${id}', ${e.message}`));
          }
        });
      });
    }
    router.logEmitter.pipe(l.pushPrefix('[Router]'));
    return Promise.join(router.started.catch(reason => {
      throw new KnownError(`Router was unable to start: ${KnownError.stringify(reason)}!`);
    }), privilegesDropped);
  }).then(() => {
    l.info(`Daemon was started successfully!`);
    send(router.printTable(), 'success');
  });
}
