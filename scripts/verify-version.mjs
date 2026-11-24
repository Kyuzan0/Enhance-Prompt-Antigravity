#!/usr/bin/env node
/**
 * Verify that package.json version is valid SemVer, publisher/author metadata
 * is intact, and CHANGELOG.md is synchronized with the current version.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function main() {
  const errors = [];
  const pkgPath = path.join(rootDir, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    console.error('[verify:version] Failed:\n  - Missing package.json at repository root.');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = String(pkg.version || '').trim();

  if (!SEMVER_RE.test(version)) {
    errors.push(`package.json has invalid SemVer version "${version}" (expected X.Y.Z).`);
  }
  if (pkg.publisher !== 'kyuzan0') {
    errors.push(`package.json publisher must be "kyuzan0" (found "${pkg.publisher || ''}").`);
  }
  if (pkg.author?.name !== 'Kyuzan0') {
    errors.push(`package.json author.name must be "Kyuzan0" (found "${pkg.author?.name || ''}").`);
  }

  const changelogPath = path.join(rootDir, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) {
    errors.push('CHANGELOG.md not found at repository root.');
  } else {
    const changelog = fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n');
    if (!changelog.includes('## [Unreleased]')) {
      errors.push('CHANGELOG.md must contain a "## [Unreleased]" heading.');
    }
    if (version && !changelog.includes(`## [${version}]`)) {
      errors.push(`CHANGELOG.md is missing a section for current version "## [${version}]".`);
    }
    const latestReleaseMatch = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
    if (!latestReleaseMatch) {
      errors.push('CHANGELOG.md must contain a released version heading.');
    } else if (version && latestReleaseMatch[1] !== version) {
      errors.push(
        `CHANGELOG.md latest release heading (${latestReleaseMatch[1]}) does not match package.json version (${version}).`
      );
    }
  }

  if (errors.length > 0) {
    console.error('[verify:version] Failed:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(`[verify:version] OK: v${version} verified in package.json and CHANGELOG.md.`);
}

main();
