import vm from 'vm';
import Promise from 'bluebird';
import fs from 'fs';
import rl from 'require-like';
import path from 'path';
import m from 'module';
import util from './util/util.js';

Promise.promisifyAll(fs);

var f = '/usr/share/aps/node/util/logger.js';

fs.readFileAsync(f, 'utf-8').then(v => {
  var s = new vm.Script(require('module').wrap(require('babel').transform(v).code), {
    filename: 'myservice.vm'
  });
  var sb = Object.assign({}, global),
    mod = new m(f, module);
  for (var k in global) {
    if(global[k] === global)
      sb[k] = sb;
  }
  s.runInNewContext(sb, {
    displayErrors: true
  })(mod.exports, rl(f), mod, f, path.dirname(f));
  console.log(mod);
});
