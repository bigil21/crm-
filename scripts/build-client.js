'use strict';
// The shipped classic script stays byte-for-byte equivalent to the ordered sources.
// No loader, runtime dependency, eval, or new browser requests.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'src', 'crm');
const files = require('../src/crm/manifest.json');
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const target = path.join(root, 'app.js');
if (!Array.isArray(files) || new Set(files).size !== files.length || files.some(f=>!/^\d\d-[a-z-]+\.js$/.test(f))) throw Error('Invalid client source manifest');
const output = files.map(f=>read(path.join(dir,f))).join('');
if (process.argv.includes('--check')) {
  if (output !== read(target)) { console.error('app.js differs from its feature sources. Run npm run build:client.'); process.exitCode=1; }
} else if (!fs.existsSync(target) || output !== read(target)) {
  fs.writeFileSync(target,output);
}
