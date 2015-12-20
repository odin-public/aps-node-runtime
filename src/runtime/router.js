import Promise from 'bluebird';
import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import net from 'net';
import dns from 'dns';
import tls from 'tls';
import https from 'https';
import Endpoint from '../runtime/endpoint.js';
import c from '../util/constants.js';
import { LogEmitter } from '../util/logger.js';
import KnownError from '../util/knownError.js';
import util from '../util/util.js';

Promise.promisifyAll(dns);
Promise.promisifyAll(https);

const IPV4_ANY = '0.0.0.0',
  ENDPOINT_ID_MAX = Math.pow(2, 12);

export default class Router extends EventEmitter {
  constructor(tlsKey, tlsCert, endpoints) {
    super();
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
    this.tlsKey = tlsKey;
    this.tlsCert = tlsCert;
    const l = this.logEmitter = new LogEmitter();
    l.info('Initializing...', true);
    l.info('Waiting for endpoints to finish initialization...', true);
    this.table = new Map();
    this.endpoints = new Map();
    this.listeners = new Map();
    this.objectKeys = new Map();
    const dropped = [];
    let listenersState;
    this.initialized = Promise.all(endpoints.map(endpoint => {
      const id = util.createUuid(ENDPOINT_ID_MAX);
      this.endpoints.set(id, endpoint);
      this.objectKeys.set(endpoint, id);
      const state = endpoint.initialized.then(() => {
        const host = endpoint.host;
        if (net.isIP(host)) {
          l.debug(`Endpoint host identifier is already an IP address: '${host}'. No NS lookup needed!`);
          return;
        }
        l.debug(`Running NS lookup for endpoint host identifier: '${host}'...`);
        return dns.lookupAsync(host, 4).then(address => {
          l.info(`NS lookup result for '${host}' is: '${address}'!`);
          endpoint.host = address;
        }, reason => {
          throw new KnownError(`Unable to resolve main host identifier '${host}': ${reason.message}`);
        });
      }, () => {
        throw new KnownError('Failed to initialize');
      }).then(() => {
        try {
          l.info(`Endpoint with ID: '${id}' has initialized. Attaching...`);
          const newListener = this._attachEndpoint(id),
            listenerKey = `'${endpoint.host}:${endpoint.port}'`;
          l.debug(`Endpoint with ID: '${id}' was attached successfully!`);
          if (newListener !== undefined) {
            l.info(`Attempting to bind to: ${listenerKey}...`);
            newListener.listening.then(() => {
              l.debug(`Successfully started listening on: ${listenerKey}!`);
            }, reason => {
              l.error(`Failed to bind to: ${listenerKey}: ${reason.message}`);
            })
          }
        } catch(e) {
          throw new KnownError(`Failed to attach: ${e.message}`);
        }
      });
      state.catch(reason => {
        let message;
        if (reason instanceof KnownError)
          message = reason.message;
        else if (reason instanceof Error)
          message = reason.stack;
        else
          message = util.stringify(reason);
        l.error(`Dropping endpoint with ID: '${id}': ${message}`);
        this.endpoints.delete(id);
        this.objectKeys.delete(endpoint);
        dropped.push(endpoint);
      });
      return state.reflect();
    })).then(states => {
      if (!states.some(v => v.isFulfilled()))
        throw new KnownError('No endpoints could initialize!');
      const listenerStates = [];
      this.listeners.forEach(v => listenerStates.push(v.listening.reflect()));
      listenersState = Promise.all(listenerStates).then(() => {
        if (!listenerStates.some(v => v.isFulfilled()))
          throw new KnownError('No listeners could start!');
        this.emit('listening', this.listeners);
      });
      l.info(`Current routing table:\n${this.printTable()}`);
      return dropped;
    });
    this.started = this.initialized.then(() => listenersState).then(() => {
      l.info('Starting...');
      l.info('Starting endpoints for successful listeners...');
      const startingStates = [];
      this.table.forEach((endpoints, listener) => {
        if (listener.listening.isFulfilled()) {
          const listenerKey = this.objectKeys.get(listener);
          endpoints.forEach(endpoint => {
            l.debug(`Starting the endpoint with ID: '${this.objectKeys.get(endpoint)}' (key: '${endpoint.key}') for listener: '${listenerKey}'`);
            endpoint.start();
            startingStates.push(endpoint.started.reflect());
          });
        }
      });
      return Promise.all(startingStates);
    }).then(states => {
      if (!states.some(v => v.isFulfilled()))
        throw new KnownError('No endpoints could start!');
      l.info(`Endpoints have started!`);
      dropped.push(...this._cleanupTable());
      l.info(`Started successfully! Dropped ${util.pluralize('endpoint', dropped.length)} in total.`);
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

  _attachEndpoint(id) {
    const endpoint = this.endpoints.get(id);
    if (endpoint  === undefined)
      throw new KnownError(`Endpoint with ID: '${id}' not found`);
    this.listeners.forEach((v, k) => {
      let [host, port] = k.split(':');
      port = parseInt(port, 10);
      if (endpoint.host === IPV4_ANY) {
        if ((host !== IPV4_ANY) && (port === endpoint.port))
          throw new KnownError(`Port ${port} is already taken for '${host}', can't use it for IPv4_ANY ('${IPV4_ANY}')`);
      } else {
        if ((host === IPV4_ANY) && (port === endpoint.port))
          throw new KnownError(`Port ${port} is already taken for IPv4_ANY ('${IPV4_ANY}'), can't use it for '${host}'`);
      }
    });
    const objectKeys = this.objectKeys,
      table = this.table,
      listeners = this.listeners,
      options = {
        key: this.tlsKey,
        cert: this.tlsCert
      },
      {host, port} = endpoint,
      listenerKey = `${host}:${port}`;
    let listener = listeners.get(listenerKey);
    if (listener === undefined) {
      listener = https.createServer(options); //TODO: stuff some function in here
      listener.listening = new Promise((resolve, reject) => {
        listener.on('error', err => {
          listener.removeAllListeners('error').removeAllListeners('listening');
          reject(err);
        }).on('listening', () => {
          listener.removeAllListeners('error').removeAllListeners('listening');
          resolve(listener);
        }).listen(port, host);
      });
      const endpoints = new Set();
      table.set(listener, endpoints);
      listeners.set(listenerKey, listener);
      objectKeys.set(listener, listenerKey);
      endpoints.add(endpoint);
      return listener;
    } else {
      const endpoints = table.get(listener);
      endpoints.forEach(v => {
        if ((v.virtualHost === endpoint.virtualHost) && (v.name === endpoint.name))
          throw new KnownError(`Endpoint with that key already exists in the table: '${endpoint.key}'`);
      });
      endpoints.add(endpoint);
    }
  }

  _cleanupTable() {
    const l = this.logEmitter;
    l.info('Starting routing table cleanup...');
    const table = this.table,
      listeners = this.listeners,
      endpoints = this.endpoints,
      objectKeys = this.objectKeys,
      droppedEndpoints = [];
    let droppedListeners = 0;
    table.forEach((endpointsForListener, listener) => {
      if (listener.listening.isRejected()) {
        const key = objectKeys.get(listener);
        l.debug(`Removing listener with key: '${key}': failed to start!`);
        droppedListeners++;
        listeners.delete(key);
        objectKeys.delete(listener);
        table.delete(listener);
        endpointsForListener.forEach(endpoint => {
          const key = objectKeys.get(endpoint);
          l.debug(`Dropping endpoint with ID: '${key}': associated listener failed to start!`);
          endpoint.stop();
          droppedEndpoints.push(endpoint);
          endpoints.delete(key);
          objectKeys.delete(endpoint);
        });
      }
    });
    table.forEach((endpointsForListener, listener) => {
      const key = objectKeys.get(listener);
      endpointsForListener.forEach(endpoint => {
        if (endpoint.started.isRejected()) {
          const key = objectKeys.get(endpoint);
          l.debug(`Dropping endpoint with ID: '${key}': failed to start!`);
          endpoint.stop();
          droppedEndpoints.push(endpoint);
          endpointsForListener.delete(endpoint);
          endpoints.delete(key);
          objectKeys.delete(endpoint);
        }
      });
      if (endpointsForListener.size === 0) {
        l.debug(`Removing listener with key: '${key}': no associated endpoints could start!`);
        listener.close();
        droppedListeners++;
        listeners.delete(key);
        objectKeys.delete(listener);
        table.delete(listener);
      }
    });
    l.info(`Routing table cleanup finished. Removed ${util.pluralize('endpoint', droppedEndpoints.length)} and ${util.pluralize('listener', droppedListeners)}!`);
    return droppedEndpoints;
  }

  _requestHandler(root, request, response) {
    const l = this.logEmitter;
    // construct aps request
    console.log(request, response);
  }

  printTable() {
    const trees = [],
      endpoints = this.endpoints;
    let root;
    this.listeners.forEach((listener, listenerKey) => {
      const [host, port] = listenerKey.split(':');
      root = trees;
      let hostNode = root.find(v => v.label === host);
      if (hostNode === undefined) {
        hostNode = {
          label: host,
          nodes: []
        };
        root.push(hostNode);
      }
      root = hostNode.nodes;
      let portNode = root.find(v => v.label === port);
      if (portNode === undefined) {
        portNode = {
          label: port,
          nodes: []
        };
        root.push(portNode);
      }
      this.table.get(listener).forEach(endpoint => {
        const {virtualHost, name} = endpoint,
        id = this.objectKeys.get(endpoint);
        root = portNode.nodes;
        let virtualHostNode = root.find(v => v.label === virtualHost);
        if (virtualHostNode === undefined) {
          virtualHostNode = {
            label: `(${virtualHost === null ? '*' : virtualHost})`,
            nodes: []
          };
          root.push(virtualHostNode);
        }
        root = virtualHostNode.nodes;
        let nameNode = root.find(v => v.label === name);
        if (nameNode === undefined)
          root.push(`/${name} - '${id}'`);
      });
    });
    return trees.map(v => util.pipeTree(v)).join('').slice(0, -1);
  }
}