const Promise = require('bluebird'),
  util = require('./util.js'),
  fs = Promise.promisifyAll(require('fs')),
  os = require('os'),
  moment = require('moment'),
  levels = [
    'TRACE',
    'DEBUG',
    'INFO',
    'WARNING',
    'ERROR'
  ];

class Logger {
  constructor(path, openMark) {
    openMark = (openMark === false ? false : true);
    if ((typeof path !== 'string') || !path)
      throw new TypeError('\'path\' argument must be a non-empty string');
    this.path = path;
    const self = this;
    (this._ready = fs.openAsync(path, 'a', 0o644)).then(function(fd) {
      self._stream = fs.createWriteStream(undefined, {
        encoding: 'utf-8',
        fd
      });
      self._writePending();
    });
    if (openMark)
      this._log(-1, '======= Log was opened =======');
  }

  set level(level) {
    if (typeof level !== 'number')
      throw new TypeError('\'level\' argument must be a number taken from \'Logger\' class');
    if (level in levels)
      this._level = level;
    else
      throw new RangeError(`Log level not found: ${level}`);
  }

  get level() {
    return levels[this._level];
  }

  _write(date, level, data) {
    if (this._stream.closed)
      return null;
    date = moment(date);
    if (level === -1)
      return this._stream.write(`${date.format(this.dateFormat)} ${data}${os.EOL}`);
    if (level >= this._level)
      return this._stream.write(`${date.format(this.dateFormat)} [${levels[level]}] ${data}${os.EOL}`);
  }

  _log(level, data) {
    const date = new Date();
    if (!this.isActive())
      return this._pending.push([date, level, data]);
    return this._write(date, level, data);
  }

  _writePending() {
    if (!this.isActive())
      return false;
    let count = 0;
    while(this._pending.length) {
      this._write.apply(this, this._pending.shift());
      count++;
    }
    return count;
  }

  pause() {
    if (this._paused)
      return false;
    return this._paused = true;
  }

  unpause() {
    delete this._paused;
    return this._writePending();
  }

  dropPending() {
    const length = this._pending.length;
    this._pending.length = 0;
    return length;
  }

  isPaused() {
    return '_paused' in this;
  }

  set ready(v) {
    throw new Error('\'ready\' property can only be set by constructor');
  }

  get ready() {
    return this._ready;
  }

  isReady() {
    if (!this._ready.isPending())
      return this._stream.closed ? false : this._ready.isFulfilled();
  }

  isActive() {
    return this.isReady() && !this.isPaused();
  }

  close() {
    this.unpause();
    return this._stream.endAsync();
  }
}

Logger.prototype.level = 0;
Logger.prototype.dateFormat = 'YYYY-MM-DD HH:mm:ss.SSS';
Logger.prototype._pending = [];

levels.forEach(function(v, k) {
  Logger.prototype[v.toLowerCase()] = util.bind(function(k, data) {
    return this._log(k, data);
  }, Logger[v] = k);
});

module.exports = Logger;
