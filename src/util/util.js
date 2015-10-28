import util from 'util';
import 'util-is';


const NETWORK_PORT_MIN = 0,
  NETWORK_PORT_MAX = 65536;

const extensions = {
  stringify(arg) {
    //return JSON.stringify(object, null, 2); //TODO: old impl, up to debate
    return util.inspect(arg, {
      showHidden: true,
      depth: null,
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
  }
};

export default Object.assign(extensions, util);
