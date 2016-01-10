import vm from 'vm';
import Module from 'module'; // if it breaks, we're f*cked :)
import path from 'path';
import util from '../util/util.js';

const GLOBALS_WHITELIST = [
    'global',
    'process',
    'GLOBAL',
    'root',
    'Buffer',
    'clearImmediate',
    'clearInterval',
    'clearTimeout',
    'setImmediate',
    'setInterval',
    'setTimeout',
    'console',
    'core',
    '__core-js_shared__',
    'Reflect',
    'regeneratorRuntime',
    '_babelPolyfill'
  ],
  VM_OPTIONS = {
    displayErrors: false,
    timeout: 10
  };

let babel;

try {
  babel = require('babel');
} catch (err) {
}

export default class Service {
  constructor(filename, code, useBabel = false) {
    if (!(util.isNonEmptyString(filename) && (path.isAbsolute(filename))))
      throw new Error('\'filename\' must be an absolute path');
    if (typeof code !== 'string')
      throw new Error('\'code\' must be a string');
    if (useBabel && !Service.hasBabel())
      throw new Error('\'babel\' usage was selected, but module is not available');
    this.filename = filename;
    this.dirname = path.dirname(filename);
    this.code = code;
    this.useBabel = useBabel;
    this._vmOptions = Object.assign({filename}, VM_OPTIONS);
    try {
      if (useBabel) {
        this.codeBabel = babel.transform(code, {
          filename,
          sourceMaps: false, //'inline', could not get them working.. seems something overrides the 'source-map-support' module
          ast: false,
          code: true,
          compact: false
        }).code;
        this._script = new vm.Script(Service.wrap(this.codeBabel), this._vmOptions);
      } else
        this._script = new vm.Script(Service.wrap(this.code), this._vmOptions);
    } catch (err) {
      if (err instanceof SyntaxError) {
        let message;
        if (err._babel)
          message = `${err.message}\n${err.codeFrame}`;
        else
          message = err.message;
        //const stack = err.stack;
        //message = `${stack.slice(0, stack.indexOf('\n', stack.indexOf('SyntaxError')))}`; //best dirty hack 2016
        throw new SyntaxError(`Failed to compile code: ${message}`);
      }
      throw err;
    }
    const innerModule = this._module = new Module(filename, module.parent);
    innerModule.filename = filename;
    innerModule.paths = Module._nodeModulePaths(this.dirname);
    innerModule.loaded = true;
    this._require = Service._makeRequireFunction.call(innerModule);
  }

  run(context, helper) {
    if (!vm.isContext(context))
      throw new Error('\'context\' is not a VM context, call \'Service.createContext(object)\' first');
    this._script.runInContext(context, this._vmOptions)(this._module.exports, this._require, this._module, this.filename, this.dirname, helper);
    return this._module;
  }

  static hasBabel() {
    return babel !== undefined;
  }

  static createContext(object = {}, nodeGlobals = true) {
    if (nodeGlobals)
      for (let key of GLOBALS_WHITELIST)
        if ((!(key in object)) && (key in global))
          object[key] = global[key] === global ? object : global[key];
    return vm.createContext(object);
  }

  static _makeRequireFunction() { // str8 from node sources
    const Module = this.constructor,
      self = this;

    function require(path) {
      return self.require(path);
    }

    require.resolve = function(request) {
      return Module._resolveFilename(request, self);
    };
    require.main = process.mainModule;
    // Enable support to add extra extension types.
    require.extensions = Module._extensions;
    require.cache = Module._cache;
    return require;
  }

  static wrap(code) {
    return Service.wrapper[0] + code + Service.wrapper[1];
  }
}

Service.wrapper = [
  '(function (exports, require, module, __filename, __dirname, aps) { ', //same as require('module').wrapper but with 'aps'
  '\n});'
];
