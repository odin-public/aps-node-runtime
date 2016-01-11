import url from 'url';
import http, { STATUS_CODES } from 'http';
import path from 'path';
import Promise from 'bluebird';
import Endpoint from './endpoint.js';
import aps from '../aps/aps.js';
import util from '../util/util.js';

const SEP = path.posix.sep,
  DEFAULT_ERROR_CODE = 500,
  HEADERS = {
    APSC_URL: 'aps-controller-uri',
    INSTANCE_ID: 'aps-instance-id',
    PHASE: 'aps-request-phase',
    TRANSACTION_ID: 'aps-transaction-id',
    APS_VERSION: 'aps-version',
    VHOST: 'host'
  },
  pid = process.pid;

function isHttpToken(string) {
  return /^[a-zA-Z0-9_!#$%&'*+.^`|~-]+$/.test(string);
}

export class Incoming {
  constructor(request) {
    if (!(request instanceof http.IncomingMessage))
      throw new Error('\'request\' must be an instance of \'http.IncomingMessage\'');
    if (request.ended)
      throw new Error('\'request\' is no longer readable');
    this.times = {
      [pid]: {}
    };
    this._recordTime('createdDate', new Date());
    this._recordTime('created');
    this.method = request.method;
    const requestUrl = url.parse(request.url),
      pathSplit = requestUrl.pathname.split(SEP).filter(v => v.length > 0),
      headers = request.headers;
    try {
      const endpoint = pathSplit.shift();
      if (!Endpoint.isName(endpoint))
        throw new Error(`Endpoint name is invalid: '${endpoint}'`);
      this.endpoint = endpoint;
      const service = pathSplit.shift();
      if (!aps.isServiceId(service))
        throw new Error(`Service ID is invalid: '${service}'`);
      this.service = service;
      const resource = pathSplit.shift();
      if ((resource !== undefined) && !aps.isResourceId(resource))
        throw new Error(`Resource ID is invalid: '${resource}'`);
      this.resource = resource;
      this.split = pathSplit;
      this.query = requestUrl.query;
      if (!(HEADERS.APSC_URL in headers))
        throw new Error(`No APSC URL was supplied ('${HEADERS.APSC_URL}' header is missing)`);
      const apsc = String(headers[HEADERS.APSC_URL]);
      if (url.parse(apsc).host === null)
        throw new Error(`APSC URL is invalid: '${apsc}'`);
      this.apsc = apsc;
      delete headers[HEADERS.APSC_URL];
      if (!(HEADERS.INSTANCE_ID in headers))
        throw new Error(`No instance ID was supplied ('${HEADERS.INSTANCE_ID}' header is missing)`);
      const instance = String(headers[HEADERS.INSTANCE_ID]);
      if (!aps.isResourceId(instance))
        throw new Error(`Instance ID is invalid: '${instance}'`);
      this.instance = instance;
    } catch (err) {
      this.validationError = err;
    }
    delete headers[HEADERS.INSTANCE_ID];
    this.async = (headers[HEADERS.PHASE] === 'async');
    delete headers[HEADERS.PHASE];
    this.transaction = headers[HEADERS.TRANSACTION_ID];
    delete headers[HEADERS.TRANSACTION_ID];
    this.apsVersion = headers[HEADERS.APS_VERSION];
    delete headers[HEADERS.APS_VERSION];
    this.headers = Object.assign({}, headers);
    request.setEncoding('utf-8');
    this.certificate = request.socket.getPeerCertificate(true);
    this.certificate = (util.isObject(this.certificate) && Buffer.isBuffer(this.certificate.raw)) ? this.certificate : undefined;
    this._http = request;
    this.remoteAddress = request.socket.remoteAddress;
    this.body = '';
    this.ready = new Promise((resolve, reject) => {
      function removeListeners() {
        request
          .removeAllListeners('error')
          .removeAllListeners('data')
          .removeAllListeners('end');
      }
      request.on('data', v => this.body += v);
      request.on('end', () => {
        this._recordTime('ready');
        resolve(this);
        removeListeners();
      });
      request.on('error', err => {
        this._recordTime('error');
        reject(err);
        removeListeners();
      });
    });
  }

  isValid() {
    return !this.validationError;
  }

  dump(body = false) {
    return `${this.method} ${this._http.url}\n${util.stringify(this._http.headers)}${(this.body && body) ? '\n\n' + this.body : ''}`;
  }

  parseBody() {
    if (this.ready.isFulfilled())
      return this.bodyObject = JSON.parse(this.body);
    else
      throw new Error('Not all data was read from request');
  }

  elapsed(outgoing) {
    if (!(outgoing instanceof Outgoing))
      throw new Error('\'outgoing\' argument must be an instance of \'Outgoing\'');
    if (outgoing.handled.isPending())
      throw new Error('\'outgoing\' is not handled yet');
    const created = this.times[pid].created,
      handled = outgoing.times[pid].handled;
    return util.formatHrTime([handled[0] - created[0], handled[1] - created[1]]);
  }
}

export class Outgoing {
  constructor(response) {
    if (!(response instanceof http.ServerResponse))
      throw new Error('\'response\' must be an instance of \'http.ServerResponse\'');
    if (response.ended)
      throw new Error('\'response\' is no longer writable');
    this.times = {
      [pid]: {}
    };
    this._recordTime('createdDate', new Date());
    this._recordTime('created');
    this._http = response;
    this._headers = Object.assign({}, this._headers);
    this.body = '';
    this.handled = new Promise((resolve, reject) => {
      this._handled = resolve;
    });
  }

  static set defaultHeaders(headers) {
    this.prototype._headers = Object.assign({}, headers);
  }

  static get defaultHeaders() {
    return this.prototype._headers;
  }

  set code(code) {
    code = parseInt(code, 10);
    if (code in http.STATUS_CODES)
      this._code = code;
    else
      throw new Error(`Unknown HTTP status code: ${code}`);
  }

  get code() {
    return this._code;
  }

  setHeader(name, value) {
    name = String(name);
    if (!isHttpToken(name))
      throw new Error(`Header name is not a valid HTTP token: ${name}`);
    if (value === undefined) {
      delete this._headers[name];
      return;
    }
    value = (Array.isArray(value) ? value.map(v => String(v)) : String(value));
    this._headers[name] = value;
  }

  getHeader(name) {
    return this._headers[name];
  }

  removeHeader(name) {
    return this.setHeader(name, undefined);
  }

  static transformBody(value) {
    if (value instanceof Error)
      return JSON.stringify({
        code: value.code || DEFAULT_ERROR_CODE,
        type: 'Exception',
        message: value.message
      });
    return String(value);
  }

  set body(value) {
    this._body = Outgoing.transformBody(value);
  }

  get body() {
    return this._body;
  }

  dump(body = false) {
    return `${this.code} (${STATUS_CODES[this.code]})\n${util.stringify(this._headers)}${(this.body && body) ? '\n\n' + this.body : ''}`;
  }

  end(value) {
    if (value !== undefined)
      this.body += Outgoing.transformBody(value);
    this.setHeader('Content-Length', Buffer.byteLength(this.body));
    const response = this._http;
    response.writeHead(this.code, this._headers);
    response.end(this.body, 'utf-8', v => {
      this._recordTime('handled');
      this._handled(v);
    });
    return this.handled;
  }
}

Incoming.prototype._recordTime = Outgoing.prototype._recordTime = function _recordTime(name, value = process.hrtime()) {
  this.times[pid][name] = value;
};

Outgoing.prototype.code = 200;

Outgoing.defaultHeaders = {
  'Server': `Node.js ${process.version}`
};

export default {
  Incoming,
  Outgoing,
  isHttpToken
};
