

export default class Resource {
  constructor() {
    throw new Error('Not implemented yet');
  }

  static create(object, constructor) {
    const result = new constructor();
    for (let key in object) {
      if (!(key in result))
        result[key] = object[key];
    }
    return result;
  }
}
