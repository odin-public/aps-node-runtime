import util from './util.js';
import { LogEmitter } from './logger.js';

export default class ConfigValidator {
  constructor(defaults, overrides) {
    if (!util.isObject(defaults))
      throw new TypeError('\'defaults\' argument is expected to be an object');
    this.logger = new LogEmitter();
    this._config = defaults;
    if (util.isObject(overrides)) {
      this._config = Object.assign(Object.create(defaults), overrides);
      this._hasCustom = true;
    }
  }

  validate(validators) {
    if (!util.isObject(validators))
      throw new TypeError('\'validators\' argument is expected to be an object');
    const l = this.logger,
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
            reason = `default, custom value: ${util.inspect(value)} is invalid for key: '${key}'`;
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
      l[level](`${message} ${util.inspect(value)} (${reason})!`);
      result[key] = value;
    }
    return result;
  }
}