export const pathProgram =
  'module.exports = (value) => value.split(require("node:path").sep).at(-1);\n';
export const portablePathProgram = 'module.exports = (value) => value.split(/[\\\\/]/).at(-1);\n';
export const smokeProgram = String.raw`
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.equal(fs.existsSync('.env.local'), process.platform === 'win32');
if (process.platform === 'darwin') assert.equal(process.env.OPENAI_API_KEY, undefined);
assert.equal(require('./path-label.cjs')('C:\\kivuno\\registration'), 'registration');
console.log(process.platform);
`;
