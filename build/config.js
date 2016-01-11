var config = {
  VERSION: '0.1.0',
  NODE_MIN_VERSION: '5.0.0',
  BABEL_VERSION: '5.8.34',
  BLUEBIRD_VERSION: '3.1.1',
  MOMENT_VERSION: '2.11.1',
  UTILIS_VERSION: '1.0.2',
  SOURCEMAP_VERSION: '0.4.0',
  MAIN_CONFIG: {
    logLevel: 'TRACE',
    defaultHost: '0.0.0.0',
    defaultPort: 443,
    defaultVirtualHost: null
  },
  ENDPOINT_CONFIG: {
    logLevel: 'TRACE',
    dummy: false
  },
  INSTANCE_CONFIG: {
    logLevel: 'TRACE',
    checkCertificate: true
  },
  linux: {
    DIR_PREFIX: '',
    HOME_DIR: '/usr/share/aps/node',
    CONFIG_DIR: '/etc/aps/node',
    ENDPOINT_DIR: '/var/aps-node',
    LOG_DIR: '/var/log',
    IDENTITY: 'aps-node',
  },
  win32: {

  }
};

Object.assign(config, config[process.platform]);

delete config.linux;
delete config.win32;

var query = process.argv[2];

if (query) {
  if (['HOME_DIR', 'CONFIG_DIR', 'ENDPOINT_DIR', 'LOG_DIR'].indexOf(query) !== -1)
    console.log(require('path').resolve(config.DIR_PREFIX, config[query]));
  else if (query === 'MAIN_CONFIG')
    console.log(JSON.stringify(config.MAIN_CONFIG, null, 2));
  else
    console.log(config[query]);
} else {
  for (var key of ['NODE_MIN_VERSION', 'BABEL_VERSION', 'BLUEBIRD_VERSION', 'MOMENT_VERSION', 'UTILIS_VERSION', 'SOURCEMAP_VERSION']) 
    delete config[key];

  process.stdout.write('export default ' + require('util').inspect(config, {
    depth: null,
    customInspect: false
  }) + '\n');
}
