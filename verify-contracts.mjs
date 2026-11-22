import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const modelCatalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'contracts', 'model-catalog.json'), 'utf8')
);
const strictPolicy = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'contracts', 'strict-deny-policy.json'), 'utf8')
);

const extSrc = fs.readFileSync(path.join(__dirname, 'extension.js'), 'utf8');
assert.ok(
  extSrc.includes(strictPolicy.toolPermission),
  `Missing toolPermission "${strictPolicy.toolPermission}" in extension.js`
);
for (const rule of strictPolicy.permissions.deny) {
  assert.ok(extSrc.includes(rule), `Missing deny rule "${rule}" in extension.js`);
}

const ideExt = require(path.join(__dirname, 'extension.js'));
for (const tc of modelCatalog.resolutionCases) {
  const actual = ideExt.resolveDynamicModel(tc.input);
  assert.equal(
    actual,
    tc.expectedWire,
    `resolveDynamicModel("${tc.input}") returned "${actual}", expected "${tc.expectedWire}"`
  );
}

console.log('IDE_CONTRACTS_VERIFIED_OK');
