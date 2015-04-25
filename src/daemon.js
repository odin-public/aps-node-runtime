if (require.main !== module)
  throw new Error('This is the main entry point for APS io.js runtime, do not attempt to use it inside \'require\'');

const fs = require('fs'),
  path = require('path'),
  util = require('./util/util.js'),
  meta = require('./util/meta.js'),
  Logger = require('./util/logger.js');

meta.DIR_PREFIX = path.isAbsolute(meta.DIR_PREFIX) ? meta.DIR_PREFIX : path.dirname(__filename);

const mainLogFile = path.resolve(meta.DIR_PREFIX, meta.LOG_DIR, 'aps-node.log'),
  l = new Logger(mainLogFile);

function stop(code) {
  if (code === false)
    return Promise.reject(false);
  code = code || 1;
  l.critical(`Fatal error has occurred. Stopping daemon.`);
  l.close().then(function() {
    process.exit(code);
  });
  return Promise.reject(false);
}

l.setLevel(0).isReady().then(function() {
  l.info('Starting APS io.js daemon!');
  l.debug('Reading configuration...');
  return Promise.all([
    new Promise(function(resolve, reject) {
      l.trace('Reading \'config.json\'');
      const file = path.resolve(meta.DIR_PREFIX, meta.CONFIG_DIR, 'config1.json');
      fs.readFile(file, function(err, data) {
        if (err) {
          l.critical(`Unable to open main configuration file at '${file}': ${err.message}`);
          reject(err.errno);
        } else
          resolve(data);
      })
      l.critical(`Unable to read endpoints directory at '${dir}': ${err.message}`);
      reject(err.errno);
    }),
    new Promise(function(resolve, reject) {
      l.trace('Reading \'endpoints\' directory');
      const dir = path.resolve(meta.DIR_PREFIX, meta.CONFIG_DIR, 'endpoint');
      fs.readdir(dir, function(err, files) {
        if (err) {
          l.critical(`Unable to list endpoints directory at '${dir}': ${err.message}`);
          reject(err.errno);
        } else
          resolve(files);
      });
    })
  ]);
}, function(reason) {
  //fail: unable to open main log
  console.error(`Unable to open main log at '${mainLogFile}': ${reason}`);
  process.exit(1);
}).then(function(values) {
}, stop).then(function() {
  console.log('lel');
});