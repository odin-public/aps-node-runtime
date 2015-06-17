if (require.main !== module)
  throw new Error('This is the main entry point for APS io.js runtime, do not attempt to use it inside \'require\'');

const Promise = require('bluebird'),
  fs = Promise.promisifyAll(require('fs')),
  path = require('path'),
  util = require('./util/util.js'),
  config = require('./util/config.js'),
  Logger = require('./util/logger.js');

config.DIR_PREFIX = path.isAbsolute(config.DIR_PREFIX) ? config.DIR_PREFIX : __dirname;

let mainConfig = null;

const endpoints = [],
  resolvePath = path.resolve.bind(undefined, config.DIR_PREFIX),
  l = new Logger(resolvePath(config.LOG_DIR, 'aps-node.log'));

console.info(`Opening main log: '${l.path}'...`);

l.pause();
l.ready.then(start, function(reason) {
  console.error(`Unable to open main log: ${reason}`);
  throw 1;
}).catch(function(reason) {
  let code = 1;
  if (util.isNumber(reason))
    code = reason;
  else if (util.isError(reason))
    l.error(`Unexpected error in main daemon: ${reason.stack}`);
  else
    l.error(`Caught unknown object from main daemon code: ${util.inspect(reason)}`);
  l.close().then(util.bind(process.exit, code));
});

function start() {
  console.info('Main log has been opened. Starting daemon!');
  l.info('Starting APS io.js daemon!');
  l.info('Reading configuration...');
  const endpointsPath = resolvePath(config.CONFIG_DIR, 'endpoints'),
    configPath = resolvePath(config.CONFIG_DIR, 'config.json');
  l.info(`Reading main configuration file: '${configPath}'...`);
  l.info(`Listing endpoints directory: '${endpointsPath}'...`);
  return Promise.join(fs.readFileAsync(configPath).then(function(text) {
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
  }, function(reason) {
    l.warning(`Failed to read main configuration file: ${reason.message}!`);
    throw null;
  }).reflect(), fs.readdirAsync(endpointsPath).then(function(files) {
    l.debug('Endpoints directory was listed successfully!');
    l.trace(`Endpoints directory listing: '${files.join('\', \'')}'`);
    return files;
  }, function(reason) {
    l.error(`Failed to list endpoints directory: ${reason.message}`);
    throw 1;
  }), function(fileConfig, endpointsListing) {
    l.trace();
    if (fileConfig.isFulfilled()) {
      l.info('Using main configuration from file!');
      mainConfig = util.extend(fileConfig.value(), config.MAIN_CONFIG);
    } else {
      l.info('Unable to use main configuration file. Using default configuration!');
      mainConfig = config.MAIN_CONFIG;
    }
    l.trace(`Main configuration object after merge:\n${util.stringify(mainConfig)}`);
    try {
      l.level = Logger[mainConfig.logLevel.toUpperCase()];
      l.info(`Log level set to: '${l.level}'!`);
    } catch (e) {
      l.warning(`Unable to set log level to: '${mainConfig.logLevel}'. Using '${config.MAIN_CONFIG.logLevel}'!`);
      l.level = Logger[config.MAIN_CONFIG.logLevel];
    }
    l.unpause();
    l.info('Processing endpoint configuration files...');
    l.debug('Filtering endpoints directory file list (*.json)...');
    let endpointFiles = endpointsListing.filter(function(v) {
      return v.endsWith('.json');
    });
    l.info(`Reading the following endpoint configuration files: '${endpointFiles.join('\', \'')}'`);
  });
}

function stop() {

}

function restart() {

}