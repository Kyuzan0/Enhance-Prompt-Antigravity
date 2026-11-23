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
const denySettings = ideExt.buildStrictDenySettings();
assert.equal(denySettings.toolPermission, strictPolicy.toolPermission);
for (const rule of strictPolicy.permissions.deny) {
  assert.ok(
    denySettings.permissions.deny.includes(rule),
    `Missing deny rule "${rule}" in buildStrictDenySettings()`
  );
}

for (const entry of modelCatalog.canonicalModels || []) {
  const wire = typeof entry === 'string' ? entry : entry.wire;
  const display = typeof entry === 'string' ? entry : entry.display;
  assert.equal(
    ideExt.resolveDynamicModel(wire),
    wire,
    `Canonical wire "${wire}" did not round-trip cleanly`
  );
  if (display) {
    assert.equal(
      ideExt.resolveDynamicModel(display),
      wire,
      `Canonical display "${display}" did not resolve to "${wire}"`
    );
  }
}

for (const tc of modelCatalog.resolutionCases) {
  const actual = ideExt.resolveDynamicModel(tc.input);
  assert.equal(
    actual,
    tc.expectedWire,
    `resolveDynamicModel("${tc.input}") returned "${actual}", expected "${tc.expectedWire}"`
  );
}

// Release metadata & CHANGELOG sync checks
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
assert.equal(pkg.publisher, 'kyuzan0', 'package.json publisher must remain "kyuzan0"');
assert.equal(pkg.author?.name, 'Kyuzan0', 'package.json author.name must remain "Kyuzan0"');
const changelogRaw = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8');
const latestReleaseMatch = changelogRaw.match(/^## \[(\d+\.\d+\.\d+)\]/m);
assert.ok(latestReleaseMatch, 'CHANGELOG.md must contain a released version heading');
assert.equal(
  latestReleaseMatch[1],
  pkg.version,
  `package.json version (${pkg.version}) must match latest CHANGELOG.md release (${latestReleaseMatch[1]})`
);

// .vscodeignore dev/test exclusion check
const vscodeIgnoreLines = fs
  .readFileSync(path.join(__dirname, '.vscodeignore'), 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
for (const requiredIgnore of [
  '.vscodeignore',
  'build/',
  '*.test.*',
  'scripts/',
  'contracts/',
  '.githooks/',
  'AGENTS.md',
  'install-ide-enhancer.sh',
  '.github/',
]) {
  assert.ok(
    vscodeIgnoreLines.includes(requiredIgnore),
    `.vscodeignore is missing required exclusion "${requiredIgnore}"`
  );
}

// Trusted-Types safety check for enhance-ide-hook.js
const hookSrc = fs.readFileSync(path.join(__dirname, 'enhance-ide-hook.js'), 'utf8');
assert.equal(/\.innerHTML\s*=/.test(hookSrc), false, 'enhance-ide-hook.js must not use innerHTML');
assert.equal(/\beval\s*\(/.test(hookSrc), false, 'enhance-ide-hook.js must not use eval()');

console.log('IDE_CONTRACTS_VERIFIED_OK');
