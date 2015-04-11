const util = require('./util.js'),
  fs = require('fs'),
  logLevels = [
    'TRACE',
    'DEBUG',
    'INFO',
    'ERROR'
  ];

function Logger(fileName) {
  let self = this;
  self._ready = new Promise(function(resolve, reject) {
    fs.open(fileName, 'a', 0o644, function(e, fd) {
      if (e) {
        reject(e);
      } else {
        self._fd = fd;
        self._stream = fs.createWriteStream(null, {
          fd: fd
        });
        resolve();
      }
    });
  });
}

Logger.prototype.close = function() {
    this._stream.
}

Logger.dateTimeFormat = function(date) {
  const pad = util.pad;
  return `${date.getFullYear()}-${pad(date.getMonth(), 2)}-${pad(date.getDay(), 2)} ${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(),2)}.${pad(date.getMilliseconds(),3)}`;
};

Logger.inspect = function(object, options) {
  return util.inspect(object, options ? options : {
    showHidden: false,
    depth: 3,
    colors: false
  });
};

Logger.prototype.isReady = function() {
  return this._ready ? true : false;
};

Logger.prototype._log = function(type, message) {
  const now = new Date();
  this._stream.write(`${Logger.dateTimeFormat(now)} [${logLevels[type]}] ${message}`);
};

Logger.prototype.trace = function(message) {
  return this._log(0, message);
};

Logger.prototype.debug = function(message) {
  return this._log(1, message);
};

Logger.prototype.info = function(message) {
  return this._log(2, message);
};

Logger.prototype.error = function(message) {
  return this._log(3, message);
};

module.exports = Logger;