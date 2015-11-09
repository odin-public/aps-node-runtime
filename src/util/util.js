import util from 'util';
import 'util-is';

const NETWORK_PORT_MIN = 0,
  NETWORK_PORT_MAX = 65536;

const extensions = {
  stringify(arg) {
    //return JSON.stringify(object, null, 2); //TODO: old impl, up to debate
    return util.inspect(arg, {
      showHidden: true,
      depth: 3,
      customInspect: false
    });
  },
  isNonEmptyString(arg) {
    return (typeof arg === 'string') && (arg.length > 0);
  },
  isPort(number) {
    number = parseInt(number, 10);
    return Number.isSafeInteger(number) && (number > NETWORK_PORT_MIN) && (number < NETWORK_PORT_MAX);
  },
  isHostname(string) {
    return /^(([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])$/i.test(string); //TODO: all-number hostname is invalid but not detected
  },
  capitalize(string) {
    string = String(string);
    return string.charAt(0).toUpperCase() + string.substring(1);
  },
  pluralize(word, count = 2, includeCount = false) {
    word = String(word);
    const last = word.slice(-1);
    if (includeCount)
      word = count + ' ' + word;
    if (count === 1) {
      if ((last === 's') || (last === 'S'))
        word = word.slice(0, -1);
    } else {
      if ((last !== 's') && (last !== 'S'))
        word += 's';
    }
    return word;
  },
  createUuid(max = Math.pow(2,32), radix = 16) { // yeah, yeah, non-uniform distribution
    if ((max < 0) || (max > Math.pow(10,16)))
      throw new RangeError('Maximum must be between 0 and 10^16');
    const uuid = Math.round(Math.random() * max);
    return Number.isSafeInteger(radix) ? uuid.toString(radix) : uuid;
  },
  pipeTree: function pipeTree(obj, prefix, opts) {
    if (prefix === undefined) prefix = '';
    if (!opts) opts = {};
    var chr = function(s) {
      var chars = {
        '│': '|',
        '└': '`',
        '├': '+',
        '─': '-',
        '┬': '-'
      };
      return opts.unicode === false ? chars[s] : s;
    };

    if (typeof obj === 'string') obj = {
      label: obj
    };

    var nodes = obj.nodes || [];
    var lines = (obj.label || '').split('\n');
    var splitter = '\n' + prefix + (nodes.length ? chr('│') : ' ') + ' ';

    return prefix + lines.join(splitter) + '\n' + nodes.map(function(node, ix) {
      var last = ix === nodes.length - 1;
      var more = node.nodes && node.nodes.length;
      var prefix_ = prefix + (last ? ' ' : chr('│')) + ' ';

      return prefix + (last ? chr('└') : chr('├')) + chr('─') + (more ? chr('┬') : chr('─')) + ' ' + pipeTree(node, prefix_, opts).slice(prefix.length + 2);
    }).join('');
  }
};

export default Object.assign(extensions, util);
