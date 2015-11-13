import Promise from 'bluebird';
import fs from 'fs';
import path from 'path';
import tls from 'tls';
import Endpoint from '../runtime/endpoint.js';
import c from '../util/constants.js';
import { LogEmitter } from '../util/logger.js';
import KnownError from '../util/knownError.js';
import util from '../util/util.js';

const IPV4_ANY = '0.0.0.0';

export default class Router {
  constructor(tlsKey, tlsCert, endpoints) {
    if (util.isNonEmptyString(tlsKey))
      throw new TypeError('\'tlsKey\' argument must be a non-empty string');
    if (util.isNonEmptyString(tlsCert))
      throw new TypeError('\'tlsKey\' argument must be a non-empty string');
    if (!(Array.isArray(endpoints) && endpoints.every(v => v instanceof Endpoint)))
      throw new TypeError('\'endpoints\' argument must be an array of intances of \'Endpoint\'');
    try {
      tls.createSecureContext({
        key: tlsKey,
        cert: tlsCert
      });
    } catch(e) {
      throw new Error(`Failed to use the provieded TLS credentials: ${e.message}`);
    }
    const l = this.logger = new LogEmitter();
    l.info('Initializing...', true);
    l.info('Waiting for endpoints to finish initialization...', true);
    this.table = new Map();
    this.endpoints = endpoints.slice(); //copy that
    this.endpointIds = new Map();
    this.initialized = Promise.all(this.endpoints.map(v => {
      this.endpointIds.set(v, util.createUuid(Math.pow(2, 12))); //arbitrary upper bound that is not too big and not too small, to avoid collisions, 12 bits aka 3 hex chars here
      return v.initialized.reflect();
    })).then(() => {
      l.debug('Attaching endpoints. Dropping endpoints that failed to initialize...');
      const dropped = [];
      this.endpoints.forEach((v, k) => {
        if (v.initialized.isFulfilled()) {
          try {
            this._attachEndpoint(v);
          } catch(e) {
            l.error(`Dropping initialized endpoint with key: '${v.key}', reason: ${e.message}`);
          }
        } else {
          this.endpoints.splice(k, 1);
          dropped.push(v);
        }
      });
      l.info(`Current routing table:\n${this.printTable()}`);
      return dropped;
    });
    this.started = this.initialized.then(() => {
      l.info('Starting...');
      // start code;
    });
    this.started.catch(reason => {
      let message;
      if (reason instanceof KnownError)
        message = reason.message;
      else if (reason instanceof Error)
        message = reason.stack;
      else
        message = util.stringify(reason);
      l.error(`Failed to ${this.initialized.isFulfilled() ? 'start' : 'initialize'}: ${message}`);
    });
  }

  _attachEndpoint(endpoint) {
    let item,
      container;
    if (endpoint.host === IPV4_ANY) {
      try {
        this.table.forEach((v, k) => {
          if (v.has(endpoint.port))
            throw k;
        });
      } catch(host) {
        throw new Error(`Port ${endpoint.port} is already taken for '${host}', can't use it for IPv4_ANY ('${IPV4_ANY}')`);
      }
    } else {
      if ((item = this.table.get(IPV4_ANY)) && (item.get(endpoint.port)))
        throw new Error(`Port ${endpoint.port} is already taken for IPv4_ANY ('${IPV4_ANY}')`);
    }
    item = this.table;
    for (let v of['host', 'port', 'virtualHost']) {
      container = item;
      item = container.get(endpoint[v]);
      if (item === undefined) {
        item = new Map();
        container.set(endpoint[v], item);
      }
    }
    container = item;
    item = container.get(endpoint.name);
    if (item === undefined) {
      container.set(endpoint.name, endpoint);
    } else {
      throw new Error(`Endpoint with that key already exists in the table: '${endpoint.key}'`);
    }
  }

  _requestHandler(request, response) {
    // construct aps request
  }

  printTable(includeStatus = false) {
    const tree = [];
    this.table.forEach((v, k) => {
      const item = {
        label: k,
        nodes: []
      };
      tree.push(item);
      v.forEach((v1, k1) => {
        const item1 = {
          label: `:${k1}`,
          nodes: []
        };
        item.nodes.push(item1);
        v1.forEach((v2, k2) => {
          const item2 = {
            label: `(${k2 === null ? '*' : k2})`,
            nodes: []
          };
          item1.nodes.push(item2);
          v2.forEach((v3, k3) => {
            item2.nodes.push(`/${k3}`);
          });
        });
      });
    });
    return tree.map(v => util.pipeTree(v)).join('').slice(0, -1);
  }
}