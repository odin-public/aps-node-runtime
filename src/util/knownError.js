export default class KnownError extends Error {
  constructor(message) {
    super();
    this.name = 'Error';
    this.message = message;
    Error.captureStackTrace(this, KnownError);
  }
}
