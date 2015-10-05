if (require.main !== module)
  throw new Error('This is the daemon for APS Node.js runtime, do not attempt to use it as a module');

import Promise from 'bluebird';
import fs from 'fs';
import path from 'path';
import util from './util/util.js';
import c from './util/constants.js';
import Logger from './util/logger.js';
import ConfigValidator from './util/configValidator.js';
import Router from './runtime/router.js';
import Endpoint from './runtime/endpoint.js';

Promise.promisifyAll(fs);

c.DIR_PREFIX = path.isAbsolute(c.DIR_PREFIX) ? c.DIR_PREFIX : __dirname;

function getAssetPath() {
  return path.resolve(c.DIR_PREFIX, ...arguments);
}

function send(message, type) { // this crap is blocked by iojs/#760, beware
  return process.send({
    type: type || 'error',
    message
  });
}

const endpointConfigSuffix = '.json',
  exitCodes = {
    GENERAL_FAILURE: 1
  },
  l = new Logger(getAssetPath(c.LOG_DIR, 'aps-node.log'));

process
  .on('uncaughtException', error => {
    send(error.stack);
    l.unpause();
    l.close().then(() => process.exit(exitCodes.GENERAL_FAILURE));
  })
  .on('unhandledRejection', reason => {
    send(util.isError(reason) ? reason.stack : reason);
    l.unpause();
    l.close().then(() => process.exit(exitCodes.GENERAL_FAILURE));
  });

process.send({
  type: 'config',
  logPath: l.path
});

l.pause();

l.ready
  .then(start, reason => {
    send(`Unable to open main log: ${reason}`);
    throw exitCodes.GENERAL_FAILURE;
  })
  .catch(reason => {
    process.exitCode = exitCodes.GENERAL_FAILURE;
    if (util.isNumber(reason))
      process.exitCode = reason;
    else if (util.isError(reason)) {
      send(reason.stack);
      l.critical(`Unexpected error in main daemon code: ${reason.stack}`);
    } else if (!util.isNullOrUndefined(reason)) {
      process.send(reason);
      l.critical(`Caught unknown object from main daemon code: ${util.inspect(reason)}`);
    }
    l.unpause();
    l.close().then(() => process.exit());
  });

function start() {
  let configPath,
    endpointsPath,
    mainConfig,
    endpoints;
  l.info('Starting APS Node.js daemon!');
  endpointsPath = getAssetPath(c.CONFIG_DIR, 'endpoints');
  l.info(`Listing endpoints directory: '${endpointsPath}'...`);
  configPath = getAssetPath(c.CONFIG_DIR, 'config.json');
  l.info(`Reading main configuration file: '${configPath}'...`);
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
    l.debug('Main configuration file was parsed successfully!');
    l.trace(`Main configuration file representation:\n${util.stringify(parsed)}`);
    return parsed;
  }, reason => {
    l.error(`Failed to read main configuration file: ${reason.message}!`);
    throw null;
  }).reflect(), fs.readdirAsync(endpointsPath).then(listing => {
    l.debug('Endpoints directory was listed successfully!');
    if (listing.length === 0) {
      l.critical(`Endpoints directory is empty. Nothing to do!`);
      throw exitCodes.GENERAL_FAILURE;
    } else {
      l.trace(`Endpoints directory listing: '${listing.join('\', \'')}'`);
      return listing;
    }
  }, reason => {
    l.critical(`Failed to list endpoints directory: ${reason.message}`);
    throw exitCodes.GENERAL_FAILURE;
  }), (fileConfig, endpointsListing) => {
    l.debug('Computing main configuration...');
    let cv;
    if (fileConfig.isFulfilled()) {
      l.info('Using custom main configuration from file!');
      cv = new ConfigValidator(c.MAIN_CONFIG, fileConfig.value());
    } else {
      l.info('Unable to use main configuration file. Using default configuration!');
      cv = new ConfigValidator(c.MAIN_CONFIG);
    }
    cv.logger.pipe(l);
    mainConfig = cv.validate({
      'logLevel': ['log level', v => {
        v = v.toUpperCase();
        const oldValue = l.level;
        try {
          l.level = Logger[v];
        } catch (e) {
          return;
        }
        l.level = Logger[oldValue];
        return v;
      }],
      'defaultIP': ['default endpoint IP', v => util.isIPv4(v) ? v : undefined],
      'defaultPort': ['default endpoint port', v => {
        v = parseInt(v, 10);
        return util.isPort(v) ? v : undefined;
      }],
      'defaultHostname': ['default endpoint hostname', v => ((v === null) || util.isHostname(v)) ? v.toLowerCase() : undefined]
    });
    cv.logger.unpipe(l);
    l.level = Logger[mainConfig.logLevel];
    l.unpause();
    Endpoint.defaultIP = mainConfig.defaultIP;
    Endpoint.defaultPort = mainConfig.defaultPort;
    Endpoint.defaultHostname = mainConfig.defaultHostname;
    l.debug(`Selecting configuration files in the endpoints directory (*${endpointConfigSuffix})...`);
    endpoints = endpointsListing.filter(v => (v.length > endpointConfigSuffix.length) && v.endsWith(endpointConfigSuffix)); // no dotfiles
    if (endpoints.length === 0) {
      l.critical(`No endpoint configuration files found (*${endpointConfigSuffix}). Nothing to do!`);
      throw exitCodes.GENERAL_FAILURE;
    }
    l.info(`Creating the router with these endpoints: '${endpoints.join('\', \'')}'`);
    const router = new Router(endpoints.map(v => new Endpoint(path.resolve(endpointsPath, v))));
    router.logger.pipe(l);
    return router.initialized;
  }).then((count) => {
    l.info(`Router was initialized with ${util.pluralize('endpoint', count, true)}...`);
  }, reason => {
    l.critical(`Router has failed to initialize: ${reason.message}!`);
    throw exitCodes.GENERAL_FAILURE;
  })//.then(); ready state
}
