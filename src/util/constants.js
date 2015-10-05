export default {
  DIR_PREFIX: '',
  CONFIG_DIR: '/etc/aps/node',
  ENDPOINT_DIR: '/var/aps-node',
  LOG_DIR: '/var/log',
  USER: 'aps-node',
  MAIN_CONFIG: {
    logLevel: 'TRACE',
    defaultIP: '0.0.0.0',
    defaultPort: 443,
    defaultHost: null
  },
  ENDPOINT_CONFIG: {
    logLevel: 'TRACE',
    dummy: false
  },
  INSTANCE_CONFIG: {
    logLevel: 'TRACE',
    checkCertificate: true
  }
};
