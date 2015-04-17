const util = require('util');
module.exports = util;
exports = module.exports;

function extend(target, source) {
  for (let k in source) {
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

function pad(number, length) {
  number = String(number);
  length = length || 2;
  while (number.length < length) number = '0' + number;
  return number;
}
exports.pad = pad;
exports.extend = extend;
