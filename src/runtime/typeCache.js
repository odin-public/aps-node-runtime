import util from '../util/util.js';

export default class TypeCache {
  constructor(object) {
    this.types = {};
    Object.assign(this.types, object);
  }

  get size() {
    return 0;
  }
}
