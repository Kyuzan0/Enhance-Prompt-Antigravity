#!/usr/bin/env node
/**
 * SemVer release automation for ag-ide-prompt-enhancer.
 * Usage: node scripts/release.mjs <patch|minor|major|X.Y.Z> [--dry-run] [--no-build] [--tag] [--from-git]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function bumpSemver(current, target) {
  const m = String(current || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Current version "${current}" is not valid X.Y.Z SemVer`);
  const [, maj, min, pat] = m.map(Number);

  if (target === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (target === 'minor') return `${maj}.${min + 1}.0`;
  if (target === 'major') return `${maj + 1}.0.0`;
  if (/^\d+\.\d+\.\d+$/.test(target)) return target;
  throw new Error(`Invalid bump target "${target}". Use patch, minor, major, or X.Y.Z.`);
}

function getRepoBaseUrl(pkg) {
  const raw = pkg.repository && typeof pkg.repository === 'object' ? pkg.repository.url : pkg.repository;
  return String(raw || 'https://github.com/Kyuzan0/Enhance-Prompt-Antigravity').replace(/\.git$/i, '').trim();
}

function collectGitCommits(prevVersion) {
  try {
    let range = 'HEAD~10..HEAD';
    try {
      execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/v${prevVersion}`], { cwd: rootDir, stdio: 'ignore' });
      range = `v${prevVersion}..HEAD`;
    } catch {
      // no tag for prevVersion; fall back to recent commits
    }
    const out = execFileSync('git', ['log', '--pretty=format:%s', range], { cwd: rootDir, encoding: 'utf8' }).trim();
    if (!out) return '';
    const added = [];
    const fixed = [];
    const changed = [];
    for (const line of out.split(/\r?\n/)) {
      const msg = line.trim();
      if (!msg) continue;
      if (/^feat(?:\([^)]*\))?:/i.test(msg)) added.push(`- ${msg}`);
      else if (/^fix(?:\([^)]*\))?:/i.test(msg)) fixed.push(`- ${msg}`);
      else changed.push(`- ${msg}`);
    }
    const sections = [];
    if (added.length) sections.push('### Added\n' + added.join('\n'));
    if (changed.length) sections.push('### Changed\n' + changed.join('\n'));
    if (fixed.length) sections.push('### Fixed\n' + fixed.join('\n'));
    return sections.join('\n\n');
  } catch {
    return '';
  }
}

function updateChangelog(changelogPath, prevVersion, nextVersion, repoBase, fromGit) {
  if (!fs.existsSync(changelogPath)) {
    throw new Error(`CHANGELOG.md not found at ${changelogPath}`);
  }
  const today = new Date().toISOString().slice(0, 10);
  let raw = fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n');

  const unreleasedHeader = '## [Unreleased]';
  const idx = raw.indexOf(unreleasedHeader);
  if (idx === -1) {
    throw new Error('CHANGELOG.md must contain a "## [Unreleased]" section.');
  }

  const afterHeaderIdx = idx + unreleasedHeader.length;
  const nextSectionMatch = raw.slice(afterHeaderIdx).match(/\n## \[/);
  const sectionEndIdx = nextSectionMatch ? afterHeaderIdx + nextSectionMatch.index : raw.length;

  let unreleasedBody = raw.slice(afterHeaderIdx, sectionEndIdx).trim();
  if (!unreleasedBody || fromGit) {
    const gitBody = collectGitCommits(prevVersion);
    if (gitBody) unreleasedBody = gitBody;
  }
  if (!unreleasedBody) {
    unreleasedBody = `### Changed\n- Release v${nextVersion}.`;
  }

  const before = raw.slice(0, idx);
  const after = raw.slice(sectionEndIdx).replace(/^\n+/, '');
  let updated = `${before}## [Unreleased]\n\n## [${nextVersion}] - ${today}\n\n${unreleasedBody}\n\n${after}`;

  // Update comparison links at bottom
  const unreleasedLinkRe = /^\[Unreleased\]:.*$/m;
  const newUnreleasedLink = `[Unreleased]: ${repoBase}/compare/v${nextVersion}...HEAD`;
  const newVersionLink = `[${nextVersion}]: ${repoBase}/compare/v${prevVersion}...v${nextVersion}`;
  if (unreleasedLinkRe.test(updated)) {
    updated = updated.replace(unreleasedLinkRe, `${newUnreleasedLink}\n${newVersionLink}`);
  } else {
    updated = updated.trimEnd() + `\n\n${newUnreleasedLink}\n${newVersionLink}\n`;
  }

  return updated;
}

function runNode(args) {
  execFileSync(process.execPath, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
}

function main() {
  const argv = process.argv.slice(2);
  const target = argv.find((a) => !a.startsWith('-'));
  const dryRun = argv.includes('--dry-run');
  const noBuild = argv.includes('--no-build');
  const withTag = argv.includes('--tag');
  const fromGit = argv.includes('--from-git');

  if (!target) {
    console.error('Usage: node scripts/release.mjs <patch|minor|major|X.Y.Z> [--dry-run] [--no-build] [--tag] [--from-git]');
    process.exit(1);
  }

  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const prevVersion = pkg.version;
  const nextVersion = bumpSemver(prevVersion, target);
  if (nextVersion === prevVersion) {
    throw new Error(`Target version ${nextVersion} equals current version.`);
  }

  const changelogPath = path.join(rootDir, 'CHANGELOG.md');
  const nextChangelog = updateChangelog(changelogPath, prevVersion, nextVersion, getRepoBaseUrl(pkg), fromGit);

  if (dryRun) {
    console.log(`[release --dry-run] ${prevVersion} -> ${nextVersion}`);
    console.log('[release --dry-run] CHANGELOG.md preview:\n' + nextChangelog.slice(0, 1200));
    return;
  }

  pkg.version = nextVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  fs.writeFileSync(changelogPath, nextChangelog, 'utf8');
  console.log(`[release] Bumped package.json & CHANGELOG.md: ${prevVersion} -> ${nextVersion}`);

  // Verify syntax, unit tests, and contracts
  runNode(['--check', 'extension.js']);
  runNode(['--check', 'enhance-ide-hook.js']);
  runNode(['--check', 'scripts/package-vsix.mjs']);
  runNode(['--check', 'scripts/release.mjs']);
  runNode(['--check', 'scripts/auto-bump-on-commit.mjs']);
  runNode(['--test', 'ide-extension.test.mjs']);
  runNode(['verify-contracts.mjs']);

  if (!noBuild) {
    runNode(['scripts/package-vsix.mjs']);
  }

  if (withTag) {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: rootDir, encoding: 'utf8' }).trim();
    if (status) {
      console.log(`[release] Working tree has uncommitted changes; commit first, then tag:`);
      console.log(`  git add -A && git commit -m "chore(release): v${nextVersion}" && git tag -a "v${nextVersion}" -m "Release v${nextVersion}"`);
    } else {
      execFileSync('git', ['tag', '-a', `v${nextVersion}`, '-m', `Release v${nextVersion}`], { cwd: rootDir, stdio: 'inherit' });
    }
  }
}

main();
