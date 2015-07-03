if (require.main !== module)
  throw new Error('This is the main entry point for APS io.js runtime, do not attempt to use it inside \'require\'');

import Promise from 'bluebird';
import fs from 'fs';
import path from 'path';
import util from './util/util.js';
import c from './util/constants.js';
import Logger from './util/logger.js';

Promise.promisifyAll(fs);

c.DIR_PREFIX = path.isAbsolute(c.DIR_PREFIX) ? c.DIR_PREFIX : __dirname;

const exitCodes = {
    GENERAL_FAILURE: 1
  },
  PORT_LOWER_BOUND = 0,
  PORT_UPPER_BOUND = 65536,
  getAssetPath = util.bind(path.resolve, c.DIR_PREFIX),
  l = new Logger(getAssetPath(c.LOG_DIR, 'aps-node.log'));

let mainConfig,
  endpoints;

console.info(`Opening main log: '${l.path}'...`);

l.pause();
l.ready.then(start, reason => {
  console.error(`Unable to open main log: ${reason}`);
  throw exitCodes.GENERAL_FAILURE;
}).catch(reason => {
  let code = exitCodes.GENERAL_FAILURE;
  if (util.isNumber(reason))
    code = reason;
  else if (util.isError(reason))
    l.error(`Unexpected error in main daemon: ${reason.stack}`);
  else
    l.error(`Caught unknown object from main daemon code: ${util.inspect(reason)}`);
  l.close().then(() => process.exit(code));
});

function start() {
  console.info('Main log has been opened. Starting daemon!');
  l.info('Starting APS io.js daemon!');
  const endpointsPath = getAssetPath(c.CONFIG_DIR, 'endpoints'),
    configPath = getAssetPath(c.CONFIG_DIR, 'config.json');
  l.info(`Reading main configuration file: '${configPath}'...`);
  l.info(`Listing endpoints directory: '${endpointsPath}'...`);
  return Promise.join(fs.readFileAsync(configPath, 'utf-8').then(text => {
    l.debug('Main configuration file was read successfully!');
    l.trace(`Main configuration file contents:\n${text}`);
    try {
      l.debug('Parsing main configuration file contents...');
      const parsed = JSON.parse(text);
      l.debug('Main configuration file was parsed successfully!');
      return parsed;
    } catch (e) {
      l.warning(`Failed to parse main configuration file contents: ${e.message}`);
      throw null;
    }
  }, reason => {
    l.warning(`Failed to read main configuration file: ${reason.message}!`);
    throw null;
  }).reflect(), fs.readdirAsync(endpointsPath).then(files => {
    l.debug('Endpoints directory was listed successfully!');
    if (files.length) {
      l.trace(`Endpoints directory listing: '${files.join('\', \'')}'`);  
      return files;
    } else {
      l.error(`Endpoints directory is empty. Nothing to do!`);
      throw exitCodes.GENERAL_FAILURE;
    }    
  }, reason => {
    l.error(`Failed to list endpoints directory: ${reason.message}`);
    throw exitCodes.GENERAL_FAILURE;
  }), (fileConfig, endpointsList) => {
    l.debug('Computing main configuration...');
    if (fileConfig.isFulfilled()) {
      l.info('Using custom main configuration from file!');
      mainConfig = fileConfig.value();
    } else {
      l.info('Unable to use main configuration file. Using default configuration!');
      mainConfig = {};
    }
    l.trace(`Main configuration was set to:\n${util.stringify(mainConfig)}`);
    l.debug('Computing log level...');
    if ('logLevel' in mainConfig) {
      try {
        l.debug('Attempting to use custom log level...');
        l.level = Logger[mainConfig.logLevel.toUpperCase()];
      } catch (e) {
        l.warning(`Using default log level. Custom value is invalid: '${mainConfig.logLevel}'`);
        l.level = Logger[c.MAIN_CONFIG.logLevel];
      }
    } else {
      l.warning('Using default log level. No custom value specified!');
      l.level = Logger[c.MAIN_CONFIG.logLevel];
    }
    mainConfig.logLevel = Logger[l.level];
    l.info(`Log level set to: '${l.level}'. Logger will now be unpaused!`);
    l.unpause();
    l.debug('Computing default endpoint port...');
    if ('defaultPort' in mainConfig) {
      if (Number.isSafeInteger(mainConfig.defaultPort) && mainConfig.defaultPort > PORT_LOWER_BOUND && mainConfig.defaultPort < PORT_UPPER_BOUND) {
        l.debug('Attempting to use custom default port...');
        //already set
      } else {
        l.warning(`Using default default port. Custom value is invalid: '${mainConfig.defaultPort}'`);
        mainConfig.defaultPort = c.MAIN_CONFIG.defaultPort;
      }
    } else {
      l.warning('Using default default port. No custom value specified!');
      mainConfig.defaultPort = c.MAIN_CONFIG.defaultPort;
    }
    l.info(`Default port set to: ${mainConfig.defaultPort}!`);
    l.debug('Processing the endpoint configuration files...');
    l.debug('Filtering files in the \'endpoints\' directory (*.json)...');
    endpoints = endpointsList.filter(v => v.endsWith('.json'));
    l.info(`Reading the following endpoint configuration files: '${endpoints.join('\', \'')}'...`);
    return endpoints.map(v => fs.readFileAsync(path.resolve(endpointsPath, v), 'utf-8'));
  }).then(enpointConfigs => {
    console.log(enpointConfigs);
  });
}

function stop() {

}

function restart() {

}