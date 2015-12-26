
'use strict';

var Module = require('module'),
  fs = require('fs'),
  path = require('path');


var file = '/var/aps-node/a/b/cloud1.js';
var code = fs.readFileSync(file, 'utf-8');

var x = new Module(file, module);

x.filename = file;
x.paths = Module._nodeModulePaths(path.dirname(file));

var f = makeRequireFunction.call(x);

console.log(x, f('./aaa.js'));


// Invoke with makeRequireFunction.call(module) where |module| is the
// Module object to use as the context for the require() function.
function makeRequireFunction() {
  const Module = this.constructor;
  const self = this;

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
