const util = require('util');

module.exports = util;
exports = module.exports;

exports.extend = function extend(target, source) {
  for (const k in source) {
    if (source.hasOwnProperty(k)) {
      if (util.isObject(source[k]) && util.isObject(target[k])) {
        target[k] = extend(target[k], source[k]);
      } else {
        target[k] = source[k];
      }
    }
  }
  return target;
};

exports.padNumber = function padNumber(number, length) {
  number = String(number);
  length = length || 2;
  while (number.length < length)
    number = '0' + number;
  return number;
};

exports.toJSON = function toJSON(object, indent) {
  indent = indent || 2;
  return JSON.stringify(object, null, indent);
};
