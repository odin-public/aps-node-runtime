import Promise from 'bluebird';
import fs from 'fs';
import path from 'path';
import tls from 'tls';
import https from 'https';
import Endpoint from '../runtime/endpoint.js';
import c from '../util/constants.js';
import { LogEmitter } from '../util/logger.js';
import KnownError from '../util/knownError.js';
import util from '../util/util.js';

const IPV4_ANY = '0.0.0.0',
  ENDPOINT_ID_UPPER_BOUND = Math.pow(2, 12);

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
    const l = this.logEmitter = new LogEmitter();
    l.info('Initializing...', true);
    l.info('Waiting for endpoints to finish initialization...', true);
    this.table = new Map();
    this.endpoints = new Map();
    this.listeners = new Map();
    this._pendingRequests = new Set();
    const dropped = [];
    l.info('Initializing...');
    this.initialized = Promise.all(endpoints.map(v => {
      const k = util.createUuid(ENDPOINT_ID_UPPER_BOUND);
      this.endpoints.set(k, v);
      v.initialized.then(() => {
        try {
          l.debug(`Endpoint with ID: '${k}' has initialized. Attaching...`);
          this._attachEndpoint(k);
        } catch(e) {
          l.error(`Dropping initialized endpoint with ID: '${k}', reason: failed to attach (${e.message})`);
          dropped.push(v);
          v.stop();
          this.endpoints.delete(k);
        }
      }, () => {
        l.error(`Dropping endpoint with ID: '${k}', reason: failed to initialize.`);
        dropped.push(v);
        this.endpoints.delete(k);
      });
      return v.initialized.reflect();
    })).then(states => {
      if (!states.some(v => v.isFulfilled()))
        throw new KnownError('No endpoints could initialize!');
      l.info(`Current routing table:\n${this.printTable()}`);
      return dropped;
    });
    this.started = this.initialized.then(() => {
      l.info('Starting...');
      l.debug('Creating HTTPS listeners...');
      const hosts = this.table,
        listenerSates = [],
        endpointStates = [];
      hosts.forEach((ports, host) => {
        ports.forEach((virtualHosts, port) => {
          const listenerKey = `${host}:${port}`;
          l.debug(`Adding listener for '${listenerKey}'...`);
          const listener = https.createServer({
            key: tlsKey,
            cert: tlsCert
          });
          listenerSates.push((new Promise((resolve, reject) => {
            listener.once('error', err => {
              listener.removeAllListeners('listening');
              l.error(`Failed to bind to '${listenerKey}': ${err.message}!`);
              reject(err);
            }).once('listening', () => {
              listener.removeAllListeners('error');
              l.info(`Successfully started listening on '${listenerKey}'!`);
              resolve();
            }).listen(port, host);
          })).reflect());
          this.listeners.set(listenerKey, listener);
          virtualHosts.forEach((names, virtualHost) => {
            names.forEach((id, name) => {
              endpointStates.push(this.endpoints.get(id).started.reflect());
            });
          });
        })
      });
      return Promise.join(Promise.all(listenerSates), Promise.all(endpointStates));
    }).spread((listenerStates, endpointStates) => {
      if (!listenerStates.some(v => v.isFulfilled()))
        throw new KnownError('No listeners could start!');
      if (!endpointStates.some(v => v.isFulfilled()))
        throw new KnownError('No endpoints could start!');
      const dropped = this._cleanupTable();
      l.info(`Current routing table:\n${this.printTable()}`);
      return dropped;
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

  addEndpoint(endpoint) {

  }

  _attachEndpoint(id) {
    const endpoint = this.endpoints.get(id);
    if (endpoint === undefined) {
      throw new Error(`No endpoint with ID: '${id}' found`);
    }
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
    for (let v of ['host', 'port', 'virtualHost']) {
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
      container.set(endpoint.name, id);
    } else {
      throw new Error(`Endpoint with that key already exists in the table: '${endpoint.key}'`);
    }
  }

  _detachEndpoint(id) {

  }

  removeEndpoint(id) {

  }

  _cleanupTable() {
    const l = this.logEmitter,
      hosts = this.table,
      endpoints = this.endpoints;
    let droppedEndpoints = [],
      droppedListeners = 0;
    l.debug('Releasing stale resources and cleaning up routing table...');
    this.listeners.forEach((v, k) => {
      if (!v._handle) {
        l.debug(`Dropping a failed listener for '${k}' and all associated endpoints...`);
        let [host, port] = k.split(':');
        port = parseInt(port);
        const ports = hosts.get(host);
        ports.get(port).forEach((names, virtualHost) => {
          names.forEach((id, name) => {
            l.debug(`Dropping endpoint with ID: '${id}', reason: listener failed to start!`);
            const endpoint = endpoints.get(id);
            endpoint.stop();
            endpoints.delete(id);
            droppedEndpoints.push(endpoint);
          });
        });
        ports.delete(port);
        if (ports.size === 0) {
          l.debug(`Removing host: '${host}' from table, reason: no ports left!`);
          hosts.delete(host);
        }
        droppedListeners++;
      }
    });
    hosts.forEach((ports, host) => {
      ports.forEach((virtualHosts, port) => {
        const listenerKey = `${host}:${port}`;
        virtualHosts.forEach((names, virtualHost) => {
          names.forEach((id, name) => {
            const endpoint = endpoints.get(id);
            if (endpoint.started.isRejected()) {
              l.debug(`Dropping endpoint with ID: '${id}', reason: failed to start!`);
              endpoint.stop();
              endpoints.delete(id);
              names.delete(name);
              droppedEndpoints.push(endpoint);
            }
          });
          if (names.size === 0) {
            l.debug(`Removing virtual host: '${virtualHost}' from table, reason: no names left!`);
            virtualHosts.delete(virtualHost);
          }
        });
        if (virtualHosts.size === 0) {
          l.debug(`Removing port: '${port}' from table, reason: no virtual hosts left! Dropping associated listener: '${listenerKey}'!`);
          ports.delete(port);
          listeners.get(listenerKey).close();
          listeners.remove(listenerKey);
          droppedListeners++;
        }
      });
      if (ports.size === 0) {
        l.debug(`Removing host: '${host}' from table, reason: no ports left!`);
        hosts.delete(host);
      }
    });
    l.debug(`Routing table cleanup finished. Dropped ${util.pluralize('endpoint', droppedEndpoints.length, true)} and ${util.pluralize('listener', droppedListeners, true)}!`);
  }

  _requestHandler(root, request, response) {
    const l = this.logEmitter;
    // construct aps request
    console.log(request, response);
  }

  printTable(includeStatus = false) {
    const trees = [];
    this.table.forEach((v, k) => {
      const item = {
        label: k,
        nodes: []
      };
      trees.push(item);
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
            item2.nodes.push(`/${k3} - '${v3}'`);
          });
        });
      });
    });
    return trees.map(v => util.pipeTree(v)).join('').slice(0, -1);
  }
}