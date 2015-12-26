import url from 'url';
import http from 'http';
import path from 'path';
import Promise from 'bluebird';
import Endpoint from './endpoint.js';
import aps from '../aps/aps.js';

const SEP = path.posix.sep,
  HEADER_APSC_URL = 'aps-controller-uri',
  HEADER_INSTANCE_ID = 'aps-instance-id',
  HEADER_PHASE = 'aps-request-phase',
  HEADER_TRANSACTION_ID = 'aps-transaction-id',
  HEADER_APS_VERSION = 'aps-version',
  HEADER_VHOST = 'host';

export default class Incoming {
  constructor(request) {
    if(!(request instanceof http.IncomingMessage))
      throw new Error('\'request\' must be an instance of \'http.IncomingMessage\'');
    this.verb = request.method;
    const requestUrl = url.parse(request.url),
      pathSplit = requestUrl.pathname.split(SEP).filter(v => v.length > 0);
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
    const headers = request.headers;
    if (!(HEADER_APSC_URL in headers))
      throw new Error(`No APSC URL was supplied ('${HEADER_APSC_URL}' header is missing)`);
    const apsc = String(headers[HEADER_APSC_URL]);
    if (url.parse(apsc).host === null)
      throw new Error(`APSC URL is invalid: '${apsc}'`);
    this.apsc = apsc;
    delete headers[HEADER_APSC_URL];
    if (!(HEADER_INSTANCE_ID in headers))
      throw new Error(`No instance ID was supplied ('${HEADER_INSTANCE_ID}' header is missing)`);
    const instance = String(headers[HEADER_INSTANCE_ID]);
    if (!aps.isResourceId(instance))
      throw new Error(`Instance ID is invalid: '${instance}'`);
    this.instance = instance;
    delete headers[HEADER_INSTANCE_ID];
    this.async = (headers[HEADER_PHASE] === 'async');
    delete headers[HEADER_PHASE];
    this.transaction = headers[HEADER_TRANSACTION_ID];
    delete headers[HEADER_TRANSACTION_ID];
    this.apsVersion = headers[HEADER_APS_VERSION];
    delete headers[HEADER_APS_VERSION];
    if (HEADER_VHOST in headers)
      this.host = headers[HEADER_VHOST];
    this.headers = Object.assign({}, headers);
    this.body = '';
    this.ready = new Promise((resolve, reject) => {
      function removeListeners() {
        request
          .removeAllListeners('error')
          .removeAllListeners('data')
          .removeAllListeners('end');
      }
      request.on('data', v => {
        this.body += v;
      });
      request.on('end', () => {
        resolve(this);
        removeListeners();
      });
      request.on('error', err => {
        reject(err);
        removeListeners();
      });
    });
  }

  parseBody() {
    if (this.ready.isFulfilled())
      return this.bodyObject = JSON.parse(this.body);
    else
      throw new Error('Not all data was read from request');
  }
}
