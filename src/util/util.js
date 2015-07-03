import util from 'util';

export default Object.assign({
  bind(fn) {
    if (typeof fn !== 'function')
      throw new TypeError(`Function expected, received: ${fn}`);
    const args = Array.prototype.slice.call(arguments, 1),
      fNOP = function() {},
      fBound = function() {
        return fn.apply(this, [...args, ...arguments]);
      };
    fNOP.prototype = fn.prototype;
    fBound.prototype = new fNOP();
    return fBound;
  },
  stringify(object) {
    return JSON.stringify(object, undefined, 2);
  }
}, util);
