import Promise from 'bluebird';
import { Logger, LogEmitter } from '../util/logger.js';
import util from '../util/util.js';

const LOG_NAME = 'instance.log';

export default class Instance {
  constructor(home, codeHome, services) {
    const l = this.logEmitter = new LogEmitter();
    l.info(`${home}, ${codeHome}, ${services}`, true);
    this.started = Promise.resolve(this).then(() => this);
  }

  static create(apsRequest) {

  }
}

Instance.defaultLogLevel = 'TRACE';
