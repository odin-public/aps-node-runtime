import util from './util.js';

export default class KnownError extends Error {
  constructor(message) {
    super();
    this.name = 'Error';
    this.message = message;
    Error.captureStackTrace(this, KnownError);
  }

  static stringify(value) {
    if (value instanceof KnownError)
      return value.message;
    else if (util.isError(value))
      return value.stack;
    else
      return util.stringify(value);
  }
}
