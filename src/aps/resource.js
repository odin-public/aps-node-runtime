import util from '../util/util.js';

export default class Resource {
  constructor() {
    throw new Error('Not implemented yet');
  }

  static create(object, constructor) {
    if (!util.isFunction(constructor))
      throw new TypeError('\'constructor\' must be a function');
    const result = new constructor();
    for (let key in object) {
      if (!(key in result))
        result[key] = object[key];
    }
    return result;
  }
}
