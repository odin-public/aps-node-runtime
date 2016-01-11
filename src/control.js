if (require.main !== module)
  throw new Error('This is the control script for APS Node.js runtime, do not attempt to use it as a module');

import childProcess from 'child_process';
import path from 'path';
import os from 'os';
import { writeFile as write } from 'fs';
import c from './util/constants.js';
import util from './util/util.js';

process.chdir(__dirname);
c.DIR_PREFIX = path.isAbsolute(c.DIR_PREFIX) ? c.DIR_PREFIX : __dirname;

const PID_FILE = 'daemon.pid',
  result = {
  fail: '[ FAIL ]',
  ok: '[  OK  ]'
};
//cutoff for start
let logPath = 'aps-node.log';

function log(data, newline = true) {
  return process.stdout.write(newline ? data + os.EOL : data);
}

function exit(message, success = false) {
  daemon
    .removeAllListeners('exit')
    .removeAllListeners('message')
    .removeAllListeners('error');
  daemon.disconnect();
  daemon.unref();
  if (success)
    log(`${result.ok} PID: ${pid}`);
  else 
    log(result.fail);
  log(message);
  log(`More information may be available in '${logPath}'.`);
}

log('Starting APS Node.js daemon... ', false);

const daemon = childProcess.fork('daemon.js', {
    //silent: true
    //stdio: ['ignore', 'ignore', 'ignore']
  }),
  pid = daemon.pid;

daemon
  .on('error', err => exit(`Unexpected error occurred: ${err.message}`))
  .on('message', message => {
    if (!(message instanceof Object)) {
      exit(`Unknown message received from the daemon: ${util.inspect(message)}`);
    } else {
      switch (message.type) {
        case 'config':
          logPath = message.logPath || logPath;
          break;
        case 'success':
          write(path.resolve(__dirname, PID_FILE), pid);
          exit(message.message, true);
          break;
        case 'error':
          exit(`Reason: ${message.message}`);
          break;
        default:
          exit(`Unknown message type received from the daemon: ${util.inspect(message)}`);
          break;
      }
    }
  })
  .on('exit', (code, signal) => {
    exit(`Daemon has stopped unexpectedly. Exit code: ${code === null ? (code + ' (crash)') : code}${signal === null ? '' : ', received signal: ' + signal}.`);
  });
