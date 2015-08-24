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
    'ERROR'
  ],
  LEVEL_NOLEVEL = -1,
  openMark = '======= Log was opened =======';

export class Logger {
  constructor(path, mode, writeOpenMark = true) {
    if ((typeof path !== 'string') || !path)
      throw new TypeError('\'path\' argument must be a non-empty string');
    if (!Number.isSafeInteger(mode)) {
      writeOpenMark = mode;
      mode = 0o644;
    }
    this.path = path;
    this._pending = [];
    this._emitters = [];
    this._handlgeLogEvent = (level, data, prefix) => {
      this._log(level, data, prefix);
    };
    (this._ready = fs.openAsync(path, 'a', mode)).then(fd => {
      this._stream = fs.createWriteStream(undefined, {
        encoding: 'utf-8',
        fd
      });
      this._writePending();
      return this;
    });
    if (writeOpenMark)
      this._log(LEVEL_NOLEVEL, openMark);
  }

  set level(level) {
    if (typeof level !== 'number')
      throw new TypeError('New level must be a number taken from \'Logger\' class');
    if (level in levels)
      this._level = level;
    else
      throw new RangeError(`Log level not found: ${level}`);
  }

  get level() {
    return levels[this._level];
  }

  _write(date, level, prefix, data) {
    if (this._stream.closed)
      throw new Error('Attempting to use a closed \'Logger\' instance');
    if (level === LEVEL_NOLEVEL)
      level = '';
    else if (level >= this._level)
      level = `[${levels[level]}]`;
    else
      return;
    prefix = `${level}${prefix === undefined ? '' : prefix}`;
    if (prefix)
      prefix += ' ';
    return this._stream.write(`${moment(date).format(this.dateFormat)} ${prefix}${data}${os.EOL}`);
  }

  _log(level, data, prefix) {
    if (!((level in levels) || (level === LEVEL_NOLEVEL)))
      throw new Error(`Cannot accept a message with unrecognized level: ${level}`);
    const date = new Date();
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

  attach(emitter) {
    if (!(emitter instanceof EventEmitter))
      throw new TypeError('\'emitter\' is expected to be \'LogEmitter\' or \'EventEmitter\'');
    this._emitters.push(emitter);
    emitter.on('log', this._handlgeLogEvent);
  }

  detach(emitter) {
    let found = 0,
      index;
    while ((index = this._emitters.indexOf(emitter)) !== -1) {
      emitter.removeListener('log', this._handlgeLogEvent)
      this._emitters.splice(index, 1);
      found++;
    }
    return found;
  }

  detachAll() {
    let count = this._emitters.length;
    this._emitters.forEach(v => {
      v.removeListener('log', this._handlgeLogEvent);
    });
    this._emitters.length = 0;
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

export class LogEmitter extends EventEmitter {
  _log(level, data, prefix) {
    this.emit('log', level, data, prefix);
  }
}

class LoggerProxy {
  constructor(logger, prefix) {
    if (!((logger instanceof Logger) || (logger instanceof LoggerProxy) || (logger instanceof LogEmitter)))
      throw new TypeError('\'logger\' is expected to be either \'Logger\', \'LoggerProxy\' or \'LogEmitter\', please use \'pushPrefix\' method instead of manual instantiation');
    this._logger = logger;
    this._prefix = prefix;
    this._emitters = [];
    this._handlgeLogEvent = (level, data, prefix) => {
      this._log(level, data, prefix);
    };
  }

  _log(level, data, prefix) {
    this._logger._log(level, data, prefix === undefined ? this._prefix : this._prefix + prefix);
  }
}

LoggerProxy.prototype.pushPrefix = LogEmitter.prototype.pushPrefix = Logger.prototype.pushPrefix;
LoggerProxy.prototype.attach = Logger.prototype.attach;
LoggerProxy.prototype.detach = Logger.prototype.detach;
LoggerProxy.prototype.detachAll = Logger.prototype.detachAll;

levels.forEach((v, k) => {
  Logger[v] = k;
  v = v.toLowerCase();
  Logger.prototype[v] = LoggerProxy.prototype[v] = LogEmitter.prototype[v] = function(data) {
    return this._log(k, data);
  };
});

export default Logger;
