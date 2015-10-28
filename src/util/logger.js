import Promise from 'bluebird';
import fs from 'fs';
import os from 'os';
import moment from 'moment';
import EventEmitter from 'events';
import util from './util.js';

Promise.promisifyAll(fs);

const levels = [
    'TRACE',
    'DEBUG',
    'INFO',
    'WARNING',
    'ERROR',
    'CRITICAL'
  ],
  LEVEL_NOLEVEL = -1,
  openMark = '======= Log was opened =======';

export class Logger {
  constructor(path, mode, writeOpenMark = true) { // TODO: fd-based and stream-based constructors
    if ((typeof path !== 'string') || !path)
      throw new TypeError('\'path\' argument must be a non-empty string');
    if (!Number.isSafeInteger(mode)) { //'shift' args
      writeOpenMark = mode;
      mode = 0o644;
    }
    this.path = path;
    this._pending = [];
    this._emitters = new Set();
    (this.ready = fs.openAsync(path, 'a', mode)).then(fd => {
      this._stream = fs.createWriteStream(null, {
        encoding: 'utf-8',
        fd
      });
      this._writePending();
      return this;
    });
    if (writeOpenMark)
      this._log(LEVEL_NOLEVEL, openMark);
  }

  static isLevel(level) {
    return level in levels;
  }

  static isLevelName(levelName) {
    return !(levels.indexOf(levelName) === -1);
  }

  static set defaultDateFormat(dateFormat) {
    this.prototype.dateFormat = String(dateFormat);
  }

  static get defaultDateFormat() {
    return this.prototype.dateFormat;
  }

  set level(level) {
    level = parseInt(level, 10);
    if (Logger.isLevel(level))
      this._level = level;
    else
      throw new RangeError(`Log level not found: ${level}`);
  }

  get level() {
    return this._level;
  }

  _write(date, level, prefix, data) {
    if (level === LEVEL_NOLEVEL) 
      level = '';
    else if (level >= this._level) 
      level = `[${levels[level]}]`;
    else
      return;
    prefix = `${level}${prefix === undefined ? '' : prefix}`;
    if (prefix.length > 0)
      prefix += ' ';
    return this._stream.write(`${moment(date).format(this.dateFormat)} ${prefix}${data}${os.EOL}`);
  }

  _log(level, prefix, data) {
    if (!((level in levels) || (level === LEVEL_NOLEVEL)))
      throw new Error(`Cannot accept a message with unrecognized level: ${level}`);
    const date = new Date();
    if (this.isReady() === false)
      throw new Error('Attempting to use a permanently inactive \'Logger\' instance');
    if (!this.isActive())
      return this._pending.push([date, level, prefix, data]);
    return this._write(date, level, prefix, data);
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

  pushPrefix(prefix) {
    return new LoggerProxy(this, prefix);
  }

  pause() {
    if (this.isPaused())
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

  isReady() {
    if (!this.ready.isPending())
      return this._stream._writableState.ending ? false : this.ready.isFulfilled();
  }

  isActive() {
    return this.isReady() && !this.isPaused();
  }

  close() {
    if (this.ready.isPending())
      return this.ready.finally(() => {
        return this.close();
      });
    else {
      for (let v of this._emitters)
        v.unpipe(this);
      this.dropPending();
      if ('_stream' in this)
        return this._stream.endAsync();
      return Promise.resolve();
    }
  }
}

Logger.prototype.level = 0; // first index of level array
Logger.defaultDateFormat = 'YYYY-MM-DD HH:mm:ss.SSS';

export class LogEmitter extends EventEmitter {
  constructor() {
    super();
    this._receivers = new Set();
    this._logNextTick = (level, prefix, data) => {
      this._log(level, prefix, data);
    };
  }

  pipe(receiver) {
    if (!((receiver instanceof Logger) || (receiver instanceof LoggerProxy) || (receiver instanceof LogEmitter)))
      throw new TypeError('\'receiver\' is expected to be either \'Logger\', \'LoggerProxy\' or \'LogEmitter\'');
    this._receivers.add(receiver);
  }

  unpipe(receiver) {
    let found = 0;
    while (this._receivers.delete(receiver))
      found++;
    return found;
  }

  unpipeAll() {
    const size = this._receivers.size;
    this._receivers.forEach(v => v._emitters.delete(this));
    this._receivers.clear();
    return size;
  }

  _log(level, prefix, data, deferred = false) {
    if (deferred) {
      process.nextTick(this._logNextTick, level, prefix, data);
      return;
    }
    this._receivers.forEach(v => v._log(level, prefix, data));
    this.emit('log', level, prefix, data);
    return this._receivers.size;
  }
}

LogEmitter.isLevel = Logger.isLevel;
LogEmitter.isLevelName = Logger.isLevelName;

class LoggerProxy {
  constructor(logger, prefix) {
    if (!((logger instanceof Logger) || (logger instanceof LoggerProxy) || (logger instanceof LogEmitter)))
      throw new TypeError('\'logger\' is expected to be either \'Logger\', \'LoggerProxy\' or \'LogEmitter\', please use \'pushPrefix\' method instead of manual instantiation');
    this._logger = logger;
    this._prefix = prefix;
  }

  _log(level, prefix, data) {
    this._logger._log(level, prefix === undefined ? this._prefix : this._prefix + prefix, data);
  }

  popPrefix() {
    return this._logger;
  }
}

LoggerProxy.prototype.pushPrefix = LogEmitter.prototype.pushPrefix = Logger.prototype.pushPrefix;

levels.forEach((v, k) => {
  Logger[v] = k;
  v = v.toLowerCase();
  Logger.prototype[v] = LoggerProxy.prototype[v] = function(data) {
    return this._log(k, undefined, data);
  };
  LogEmitter.prototype[v] = function(data, deferred) {
    return this._log(k, undefined, data, deferred);
  };
});

export default Logger;
