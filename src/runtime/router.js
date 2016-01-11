import Promise from 'bluebird';
import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import net from 'net';
import dns from 'dns';
import crypto from 'crypto';
import tls from 'tls';
import https from 'https';
import { STATUS_CODES } from 'http';
import Endpoint from '../runtime/endpoint.js';
import { Incoming, Outgoing } from './message.js';
import c from '../util/constants.js';
import { LogEmitter } from '../util/logger.js';
import KnownError from '../util/knownError.js';
import util from '../util/util.js';

Promise.promisifyAll(dns);
Promise.promisifyAll(https);

const IPV4_ANY = '0.0.0.0',
  DEFAULT_TIMEOUT = 30,
  ENDPOINT_ID_CHARS = 3,
  REQUEST_ID_CHARS = 6,
  HTTP_CODES = {
    NOT_READY: 503,
    GENERAL_ERROR: 500,
    TIMEOUT: 408,
    ENDPOINT_NOT_FOUND: 404,
    INVALID_REQUEST: 400
  };

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
    } catch (e) {
      throw new Error(`Failed to use the provided TLS credentials: ${e.message}`);
    }
    this.tlsKey = tlsKey;
    this.tlsCert = tlsCert;
    const l = this.logEmitter = new LogEmitter(),
      dropped = [];
    this.table = new Map();
    this.endpoints = new Map();
    this.listeners = new Map();
    this.objectKeys = new Map();
    l.info('Initializing...', true);
    l.info('Waiting for endpoints to finish initialization...', true);
    this.initialized = Promise.all(endpoints.map(endpoint => {
      const id = util.createUuid(ENDPOINT_ID_CHARS);
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
            });
          }
        } catch (e) {
          throw new KnownError(`Failed to attach: ${e.message}`);
        }
      });
      state.catch(reason => {
        l.error(`Dropping endpoint with ID: '${id}': ${KnownError.stringify(reason)}`);
        this.endpoints.delete(id);
        this.objectKeys.delete(endpoint);
        dropped.push(endpoint);
      });
      return state.reflect();
    })).then(states => {
      if (!states.some(v => v.isFulfilled()))
        throw new KnownError('No endpoints could initialize');
      l.info(`Initialized successfully! Dropped ${util.pluralize('endpoint', dropped.length)}. Current routing table:\n${this.printTable()}`);
      return dropped;
    });
    this.started = this.initialized.then(() => {
      const listenerStates = [];
      this.listeners.forEach(v => listenerStates.push(v.listening.reflect()));
      return Promise.all(listenerStates).then(() => {
        if (!listenerStates.some(v => v.isFulfilled()))
          throw new KnownError('No listeners could start');
        this.emit('listening', this.listeners);
      });
    }).then(() => {
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
        throw new KnownError('No endpoints could start');
      l.info(`Endpoints have started!`);
      dropped.push(...this._cleanupTable());
      l.info(`Started successfully! Dropped ${util.pluralize('endpoint', dropped.length)} in total. Current routing table:\n${this.printTable()}`);
      return dropped;
    });
    this.started.catch(reason => {
      l.error(`Failed to ${this.initialized.isFulfilled() ? 'start' : 'initialize'}: ${KnownError.stringify(reason)}!`);
    });
  }

  set timeout(seconds) {
    seconds = parseInt(seconds, 10);
    if (Number.isSafeInteger(seconds))
      this._timeout = seconds;
    else
      throw new Error(`Not a valid timeout value: ${seconds}`);
  }

  get timeout() {
    return this._timeout;
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
        cert: this.tlsCert,
        requestCert: true
      },
      {host, port} = endpoint,
      listenerKey = `${host}:${port}`;
    let listener = listeners.get(listenerKey);
    if (listener === undefined) {
      listener = https.createServer(options);
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
      listener.on('request', (request, response) => {
        this._handleRequest(endpoints, request, response);
      });
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
        listener.removeAllListeners('request');
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
        listener.removeAllListeners('request');
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

  _handleRequest(endpoints, request, response) {
    const l = this.logEmitter,
      peer = response.socket.remoteAddress;
    let incoming,
      outgoing;
    try {
      outgoing = new Outgoing(response);
    } catch (err) {
      if (response.ended)
        l.error(`Unable to handle request from '${peer}': 'response' object is no longer writable!`);
      else {
        const httpError = new Error(`Unknown error: ${err.message}`);
        response.writeHead(httpError.code = HTTP_CODES.GENERAL_ERROR, Outgoing.defaultHeaders);
        response.end(Outgoing.transformBody(httpError));
        l.error(`Unable to handle request from '${peer}' due to unknown error: ${err.stack}`);
      }
      return;
    }
    try {
      if (!this.started.isFulfilled()) {
        l.info(`Received a request from '${peer}' but not able to process yet. Dropping!`);
        const err = new Error('Daemon has not yet started. Please try again later...');
        outgoing.code = err.code = HTTP_CODES.NOT_READY;
        outgoing.end(err);
        return;
      }
      const id = util.createUuid(REQUEST_ID_CHARS),
        rl = l.pushPrefix(`[R:${id}]`);
      l.info(`Received a request from '${peer}', assigned ID: '${id}'...`);
      incoming = new Incoming(request);
      outgoing.handled.timeout(this.timeout * 1000).reflect().then(state => {
        if (state.isRejected()) {
          const reason = state.reason();
          let httpError;
          if (reason instanceof Promise.TimeoutError) {
            rl.debug(`Timeout reached after ${util.pluralize('second', this.timeout)}`);
            httpError = new Error(`Request was not handled within a timeout`);
            outgoing.code = httpError.code = HTTP_CODES.TIMEOUT;
          } else {
            httpError = new Error(`Unknown error: ${reason.message}`);
            outgoing.code = httpError.code = HTTP_CODES.GENERAL_ERROR;
            rl.error(`Failed to handle due to unkown error: ${reason.stack}`);
          }
          return outgoing.end(httpError);
        }
      }).then(() => l.info(`Request with ID: '${id}' was handled. Code: ${outgoing.code} (${STATUS_CODES[outgoing.code]}), time elapsed: ${incoming.elapsed(outgoing)} seconds.`));
      if (!incoming.isValid()) {
        const err = new Error(`Validation error: ${incoming.validationError.message}`);
        rl.debug(err.message);
        rl.trace(`Request dump:\n${incoming.dump()}`);
        outgoing.code = err.code = HTTP_CODES.INVALID_REQUEST;
        outgoing.end(err);
        return;
      }
      const endpointName = incoming.endpoint,
        virtualHost = incoming.headers.host;
      rl.debug(`Endpoint name: '${endpointName}'.`);
      rl.debug(`Virtual host: '${virtualHost || 'None'}.'`);
      let destination;
      try {
        endpoints.forEach(endpoint => {
          if ((endpoint.name === endpointName)) {
            if ((typeof virtualHost === 'string') && (virtualHost.split(':')[0] === endpoint.virtualHost))
              throw endpoint;
            if (endpoint.virtualHost === null)
              destination = endpoint;
          }
        });
      } catch (endpoint) {
        destination = endpoint;
      }
      if (destination === undefined) {
        rl.debug(`No matching endpoint found!`);
        const err = new Error(`Endpoint with name: '${endpointName}' not found on this host${virtualHost === null ? '' : ': \'' + virtualHost + '\''}`);
        outgoing.code = err.code = HTTP_CODES.ENDPOINT_NOT_FOUND;
        outgoing.end(err);
      } else {
        rl.debug(`Passing to the endpoint with ID: '${this.objectKeys.get(destination)}' and key: '${destination.key}'...`);
        destination.handleRequest(incoming, outgoing, id);
      }
    } catch (err) {
      const httpError = new Error(`Unknown error: ${err.message}`);
      outgoing.code = httpError.code = HTTP_CODES.GENERAL_ERROR;
      outgoing.end(httpError);
      l.error(`Unable to handle request from '${peer}' due to unknown error: ${err.stack}`);
    }
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

Router.prototype.timeout = DEFAULT_TIMEOUT;
