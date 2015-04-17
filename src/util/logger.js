const util = require('./util.js'),
  fs = require('fs'),
  os = require('os');

function Logger(fileName) {
  let self = this;
  self._ready = new Promise(function(resolve, reject) {
    fs.open(fileName, 'a', 0 o644, function(err, fd) {
      if (err) {
        reject(err);
      } else {
        self._stream = fs.createWriteStream(null, {
          encoding: 'utf-8',
          fd: fd
        });
        self._level = Logger.defaultLogLevel;
        resolve(self);
      }
    });
  });
}

Logger.logLevels = [
  'TRACE',
  'DEBUG',
  'INFO',
  'ERROR'
];

Logger.defaultLogLevel = Logger.logLevels.indexOf('INFO');

Logger.prototype.setLevel = function(level) {
  this._level = level; //checks
};

Logger.prototype.isReady = function() {
  return this._ready;
};

Logger.prototype.log = function(level, data) {
  if (level >= this._level) {
    return this._stream.write(`${data}${os.EOL}`);
};

Logger.prototype.close = function() {
  let self = this;
  self._stream.end(); //promise?
};

new Logger('test.txt').isReady().then(function(l) {
  Logger.logLevels.length = 0
  console.log(Logger.logLevels, logLevels);

  l.log(1, 'фыфвыф');
  l.close();
  setTimeout(function() { //more tests
    l.log(1, '2');
  }, 3000);
})