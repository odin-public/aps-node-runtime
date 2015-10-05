import util from 'util';
import 'util-is';


const NETWORK_PORT_MIN = 0,
  NETWORK_PORT_MAX = 65536;

const extensions = {
  stringify(object) {
    //return JSON.stringify(object, null, 2); //old impl, up to debate
    return util.inspect(object, {
      showHidden: true,
      depth: null,
      customInspect: false
    });
  },
  isPort(number) {
    return Number.isSafeInteger(number) && (number > NETWORK_PORT_MIN) && (number < NETWORK_PORT_MAX);
  },
  isIPv4(string) {
    const octets = string.split('.');
    return (octets.length === 4) && octets.every(v => {
      v = parseInt(v, 10);
      return (v >= 0) && (v < 256);
    });
  },
  isHostname(string) {
    return /^(([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])$/i.test(string); //bug: all-number hostname is invalid but not detected
  },
  capitalize(string) {
    return String(string).charAt(0).toUpperCase() + string.substring(1);
  },
  pluralize(word, count = 2, includeCount = false) {
    if (includeCount)
      word = count + ' ' + word;
    const lastTwo = word.slice(-2),
        secondLast = lastTwo.charAt(0);
    if ((count !== 1) && (lastTwo.charAt(1).toLowerCase() !== 's'))
      return word + (secondLast === secondLast.toUpperCase() ? 'S' : 's');
    return word;
  }
};

export default Object.assign(extensions, util);
