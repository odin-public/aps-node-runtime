import Promise from 'bluebird';
import fs from 'fs';
import path from 'path';
import c from '../util/constants.js';
import { LogEmitter } from '../util/logger.js';
import KnownError from '../util/knownError.js';
import util from '../util/util.js';

export default class Router {
  constructor(endpoints) {
    let l = this.logger = new LogEmitter();
    this._loggers = new Map();
    this.initialized = Promise.settle((this._endpoints = endpoints).map(v => {
      let epLogger = l.pushPrefix(`[${path.basename(v.configPath)}]`);
      v.logger.pipe(epLogger);
      this._loggers.set(v, epLogger);
      return v.initialized;
    })).then(results => {
      const count = results.reduce((a, v) => v.isFulfilled() ? ++a : a, 0); //is there no other way or am I just dense?
      if (count)
        return count;
      throw new Error('No endpoints could be initialized');
    });
  }

  printStatus() {
  }
}
