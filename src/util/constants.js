export default { VERSION: '0.9.0',
  MAIN_CONFIG: 
   { logLevel: 'TRACE',
     defaultHost: '0.0.0.0',
     defaultPort: 443,
     defaultVirtualHost: null },
  ENDPOINT_CONFIG: { logLevel: 'TRACE', dummy: false },
  INSTANCE_CONFIG: { logLevel: 'TRACE', checkCertificate: true },
  DIR_PREFIX: '',
  HOME_DIR: '/usr/share/aps/node',
  CONFIG_DIR: '/etc/aps/node',
  ENDPOINT_DIR: '/var/aps-node',
  LOG_DIR: '/var/log',
  IDENTITY: 'aps-node' }
