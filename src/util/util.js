const util = require('util');

module.exports = util;
exports = module.exports;

exports.extend = function extend(target, source) {
  for (const k in source) {
    if (source.hasOwnProperty(k)) {
      if (util.isObject(source[k]) && util.isObject(target[k]))
        target[k] = extend(target[k], source[k]);
      else {
        if (!target.hasOwnProperty(k))
          target[k] = source[k];
      }
    }
  }
  return target;
};

exports.bind = function(fn) {
  if (typeof fn !== 'function')
    throw new TypeError(`Function expected, received: ${fn}`);
  const args = Array.prototype.slice.call(arguments, 1),
    fNOP = function() {},
    fBound = function() {
      return fn.apply(this, args.concat(Array.prototype.slice.call(arguments)));
    };
  fNOP.prototype = fn.prototype;
  fBound.prototype = new fNOP();
  return fBound;
};

exports.stringify = function(object) {
  return JSON.stringify(object, undefined, 2);
};
