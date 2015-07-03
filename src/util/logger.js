import Promise from 'bluebird';
import util from './util.js';
import fs from 'fs';
import os from 'os';
import moment from 'moment';

Promise.promisifyAll(fs);

const levels = [
  'TRACE',
  'DEBUG',
  'INFO',
  'WARNING',
  'ERROR'
];

export default class Logger {
  constructor(path, openMark = true) {
    if ((typeof path !== 'string') || !path)
      throw new TypeError('\'path\' argument must be a non-empty string');
    this.path = path;
    const self = this;
    (this._ready = fs.openAsync(path, 'a', 0o644)).then(fd => {
      this._stream = fs.createWriteStream(undefined, {
        encoding: 'utf-8',
        fd
      });
      this._writePending();
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

  _getPrefixes() {
    if (Array.isArray(this.prefixes))
      return this.prefixes.length ? this.prefixes.slice() : null;
    else {
      this.prefixes = [];
      return null;
    }
  }

  _write(date, level, prefixes, data) {
    if (this._stream.closed)
      return null;
    date = moment(date).format(this.dateFormat);
    if (level === -1)
      return this._stream.write(`${date} ${prefixes ? prefixes.join('') : ''} ${data}${os.EOL}`);
    if (level >= this._level)
      return this._stream.write(`${date} [${levels[level]}]${prefixes ? prefixes.join('') : ''} ${data}${os.EOL}`);
  }

  _log(level, data) {
    const date = new Date(),
      prefixes = this._getPrefixes();
    if (!this.isActive())
      return this._pending.push([date, level, prefixes, data]);
    return this._write(date, level, prefixes, data);
  }

  _writePending() {
    if (!this.isActive())
      return false;
    let count = 0;
    while (this._pending.length) {
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
    throw new Error('Logger readiness state can only be set by the constructor');
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
Logger.prototype.prefixes = [];
Logger.prototype._pending = [];

levels.forEach((v, k) => {
  Logger.prototype[v.toLowerCase()] = util.bind(function(k, data) {
    return this._log(k, data);
  }, Logger[v] = k);
});
