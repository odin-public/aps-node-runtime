const util = require('./util.js'),
  fs = require('fs'),
  os = require('os'),
  levels = [
    'TRACE',
    'DEBUG',
    'INFO',
    'ERROR',
    'CRITICAL'
  ],
  defaultLevel = levels.indexOf('TRACE');

function Logger(fileName, openMark) {
  openMark = (openMark === false) ? false : true;
  if ((typeof fileName !== 'string') || !fileName)
    throw new Error('\'fileName\' argument must be a non-empty string');
  this._level = defaultLevel;
  this.formatDate = Logger.formatDate;
  const self = this;
  this._ready = new Promise(function(resolve, reject) {
    fs.open(fileName, 'a', 0o644, function(err, fd) {
      if (err) {
        reject(err);
      } else {
        self._stream = fs.createWriteStream(null, {
          encoding: 'utf-8',
          fd: fd
        });
        resolve(self);
      }
    });
  });
  if (openMark)
    self.debug('======= Log opened! =======');
}

Logger.prototype.setLevel = function(level) {
  switch (typeof level) {
    case 'string':
      {
        const index = levels.indexOf(level);
        if (index !== -1)
          this._level = index;
        else
          throw new Error(`Log level '${level}' not found`);
        break;
      }
    case 'number':
      if (level in levels)
        this._level = level;
      else
        throw new Error(`No such log level: ${level}`);
      break;
    default:
      throw new Error('\'level\' argument must be a number or a string');
  }
  return this;
};

Logger.prototype.isReady = function() {
  return this._ready;
};

Logger.formatDate = function(date) {
  const pad = util.padNumber;
  return `${date.getFullYear()}-${pad(date.getMonth(), 2)}-${pad(date.getDay(), 2)} ${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(),2)}.${pad(date.getMilliseconds(),3)}`;
};


Logger.prototype._log = function(level, data, date) {
  date = date || new Date();
  if (this._stream) {
    if (level >= this._level)
      return this._stream.write(`${this.formatDate(date)} [${levels[level]}] ${data}${os.EOL}`);
  } else {
    const self = this;
    this._ready.then(function() {
      self._log(level, data, date);
    });
  }
};

Logger.prototype.close = function() {
  const self = this;
  return new Promise(function(resolve, reject) {
    self._stream.end(function() {
      resolve(self);
    });
  });
};

Logger.prototype.trace = function(data) {
  return this._log(0, data);
};

Logger.prototype.debug = function(data) {
  return this._log(1, data);
};

Logger.prototype.info = function(data) {
  return this._log(2, data);
};

Logger.prototype.error = function(data) {
  return this._log(3, data);
};

Logger.prototype.critical = function(data) {
  return this._log(4, data);
};

module.exports = Logger;