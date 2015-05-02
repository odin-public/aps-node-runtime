if (require.main !== module)
  throw new Error('This is the main entry point for APS io.js runtime, do not attempt to use it inside \'require\'');

const fs = require('fs'),
  path = require('path'),
  util = require('./util/util.js'),
  meta = require('./util/meta.js'),
  Logger = require('./util/logger.js');

meta.DIR_PREFIX = path.isAbsolute(meta.DIR_PREFIX) ? meta.DIR_PREFIX : __dirname;

const logFile = path.resolve(meta.DIR_PREFIX, meta.LOG_DIR, 'aps-node.log'),
  l = new Logger(logFile);

function main() {
  l.info('Starting APS io.js daemon!');
  l.debug('Reading configuration...');
  return Promise.all([
    new Promise(function(resolve, reject) {
      l.trace('Reading \'config.json\'');
      const file = path.resolve(meta.DIR_PREFIX, meta.CONFIG_DIR, 'config.json');
      fs.readFile(file, {
        encoding: 'utf-8'
      }, function(err, data) {
        if (err) {
          l.critical(`Unable to open main configuration file at '${file}': ${err.message}`);
          reject(err.errno);
        } else
          resolve(data);
      });
    }),
    new Promise(function(resolve, reject) {
      l.trace('Reading \'endpoints\' directory');
      const dir = path.resolve(meta.DIR_PREFIX, meta.CONFIG_DIR, 'endpoints');
      fs.readdir(dir, function(err, files) {
        if (err) {
          l.critical(`Unable to list endpoints directory at '${dir}': ${err.message}`);
          reject(err.errno);
        } else
          resolve(files);
      });
    })
  ]).then(function(values) {
    l.debug(util.inspect(values));
  });
  //process.setgid(meta.USER);
  //process.setuid(meta.USER);
}

l.setLevel(0).isReady().then(function() {
  try {
    return main();
  } catch (e) {
    l.critical(`Exception in main daemon: ${e instanceof Error ? e.stack : util.inspect(e)}`);
    return Promise.reject(1);
  }
}, function(reason) {
  console.error(`Unable to open main log at '${logFile}': ${reason}`);
  return Promise.reject(1);
}).catch(function(code) {
  process.exitCode = code;
  l.close().then(process.exit);
});