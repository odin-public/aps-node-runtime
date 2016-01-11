import util from './util.js';
import { Logger, LogEmitter, LoggerProxy } from './logger.js';

const NEW_LINE = '\n';

export default class ConfigValidator {
  constructor(defaults, overrides) {
    if (!util.isObject(defaults))
      throw new TypeError('\'defaults\' argument is expected to be an object');
    this.logEmitter = new LogEmitter();
    this._config = defaults;
    if (util.isObject(overrides)) {
      this._config = Object.assign(Object.create(defaults), overrides);
      this._hasCustom = true;
    }
  }

  validate(validators) {
    if (!util.isObject(validators))
      throw new TypeError('\'validators\' argument is expected to be an object');
    const l = this.logEmitter,
      config = this._config,
      result = {};
    for (let key in validators) {
      let value = config[key],
        normalized,
        [name, checker] = validators[key],
        level,
        message = `${util.capitalize(name)} set to:`,
        reason;
      if (this._hasCustom) {
        l.debug(`Computing ${name}...`);
        if (config.hasOwnProperty(key)) {
          try {
            normalized = checker(value);
          } catch (e) {
            normalized = undefined;
          }
          if (normalized !== undefined) {
            level = 'info';
            reason = `custom value for key: '${key}'`;
            value = normalized;
          } else {
            level = 'error';
            reason = `default, custom value: ${util.stringify(value)} is invalid for key: '${key}'`;
            value = Object.getPrototypeOf(config)[key];
          }
        } else {
          level = 'warning';
          reason = `default, key: '${key}' not found`;
        }
      } else {
        level = 'info';
        reason = 'no custom config';
      }
      result[key] = value;
      value = util.stringify(value);
      if (value.indexOf(NEW_LINE) !== -1)
        value = NEW_LINE + value;
      l[level](`${message} ${value} (${reason})`);
    }
    return result;
  }

  static logConfig(logger, validators, config) {
    if (!((logger instanceof Logger) || (logger instanceof LogEmitter) || (logger instanceof LoggerProxy)))
      throw new TypeError('\'logger\' is expected to be either \'Logger\', \'LogEmitter\' or \'LoggerProxy\'');
    for (let key in validators) {
      let value = validators[key],
        name = value[0];
      value = config[key];
      value = util.stringify(value);
      if (value.indexOf(NEW_LINE) !== -1)
        value = NEW_LINE + value;
      logger.info(`${util.capitalize(name)} set to: ${value}`);
    }
  }
}
