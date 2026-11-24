#!/usr/bin/env node
/**
 * Automatic SemVer + CHANGELOG.md + VSIX builder invoked by .githooks/commit-msg.
 * Env toggles:
 *   SKIP_AUTO_RELEASE=1     Skip version/changelog bump completely
 *   AUTO_RELEASE_DRY_RUN=1  Print planned bump without modifying files
 *   SKIP_AUTO_VERIFY=1      Skip post-bump verification checks
 *   SKIP_AUTO_BUILD=1       Bump version & changelog without rebuilding .vsix
 *   FORCE_AUTO_RELEASE=1    Bump even if staged files do not touch runtime paths
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function bumpSemver(current, bump) {
  const m = String(current || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Invalid SemVer "${current}" in package.json`);
  const [, maj, min, pat] = m.map(Number);
  if (bump === 'major') return `${maj + 1}.0.0`;
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

function getStagedFiles() {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function isVersionAlreadyBumpedInStaged() {
  try {
    const diff = execFileSync('git', ['diff', '--cached', '--', 'package.json'], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    return /^\+\s*"version"\s*:/m.test(diff);
  } catch {
    return false;
  }
}

function classifyCommit(subject, body, stagedFiles) {
  if (!subject) return null;
  if (/^(?:Merge |Revert |fixup! |squash! |chore\(release\):|release:)/i.test(subject)) {
    return null;
  }

  const runtimeFiles = new Set([
    'extension.js',
    'enhance-ide-hook.js',
    'repair-ide-hook.js',
    'package.json',
    'install-ide-enhancer.ps1',
    'install-ide-enhancer.sh',
  ]);
  const touchesRuntime = stagedFiles.some((f) => runtimeFiles.has(f));
  if (!touchesRuntime && process.env.FORCE_AUTO_RELEASE !== '1') {
    return null;
  }

  const isBreaking = /BREAKING CHANGE/i.test(body) || /^[a-z]+(?:\([^)]*\))?!:/i.test(subject);
  const convMatch = subject.match(/^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/i);

  if (convMatch) {
    const type = convMatch[1].toLowerCase();
    const desc = convMatch[4].trim();
    if (isBreaking) return { bump: 'major', section: '### Changed', desc };
    if (type === 'feat') return { bump: 'minor', section: '### Added', desc };
    if (type === 'fix') return { bump: 'patch', section: '### Fixed', desc };
    if (type === 'perf' || type === 'refactor') return { bump: 'patch', section: '### Changed', desc };
    if (['docs', 'chore', 'style', 'test', 'ci', 'build'].includes(type)) return null;
  }

  if (isBreaking) return { bump: 'major', section: '### Changed', desc: subject };

  if (touchesRuntime || process.env.FORCE_AUTO_RELEASE === '1') {
    return { bump: 'patch', section: '### Changed', desc: subject };
  }
  return null;
}

function updateChangelog(changelogPath, prevVersion, nextVersion, section, desc, repoBase) {
  const today = new Date().toISOString().slice(0, 10);
  let raw = fs.existsSync(changelogPath)
    ? fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n')
    : `# Changelog\n\n## [Unreleased]\n`;

  const unreleasedHeader = '## [Unreleased]';
  const idx = raw.indexOf(unreleasedHeader);
  if (idx === -1) {
    throw new Error('CHANGELOG.md is missing "## [Unreleased]" heading.');
  }

  const afterHeaderIdx = idx + unreleasedHeader.length;
  const nextSectionMatch = raw.slice(afterHeaderIdx).match(/\n## \[/);
  const sectionEndIdx = nextSectionMatch ? afterHeaderIdx + nextSectionMatch.index : raw.length;

  let body = raw.slice(afterHeaderIdx, sectionEndIdx).trim();
  if (!body) {
    body = `${section}\n- ${desc}`;
  } else if (!body.includes(desc)) {
    body = `${body}\n\n${section}\n- ${desc}`;
  }

  const before = raw.slice(0, idx);
  const after = raw.slice(sectionEndIdx).replace(/^\n+/, '');
  let updated = `${before}## [Unreleased]\n\n## [${nextVersion}] - ${today}\n\n${body}\n\n${after}`;

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

function main() {
  if (process.env.SKIP_AUTO_RELEASE === '1') return;

  const msgFile = process.argv[2];
  if (!msgFile || !fs.existsSync(msgFile)) return;

  const rawMsg = fs.readFileSync(msgFile, 'utf8');
  const lines = rawMsg.split(/\r?\n/).filter((l) => !l.startsWith('#'));
  const subject = (lines[0] || '').trim();
  const body = lines.slice(1).join('\n').trim();

  if (isVersionAlreadyBumpedInStaged()) return;

  const stagedFiles = getStagedFiles();
  const plan = classifyCommit(subject, body, stagedFiles);
  if (!plan) return;

  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const prevVersion = pkg.version;
  const nextVersion = bumpSemver(prevVersion, plan.bump);

  if (process.env.AUTO_RELEASE_DRY_RUN === '1') {
    console.log(`[auto-release --dry-run] ${prevVersion} -> ${nextVersion} (${plan.bump}) | ${plan.section}: ${plan.desc}`);
    return;
  }

  const repoRaw = pkg.repository && typeof pkg.repository === 'object' ? pkg.repository.url : pkg.repository;
  const repoBase = String(repoRaw || 'https://github.com/Kyuzan0/Enhance-Prompt-Antigravity').replace(/\.git$/i, '').trim();

  pkg.version = nextVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  const clPath = path.join(rootDir, 'CHANGELOG.md');
  const nextCl = updateChangelog(clPath, prevVersion, nextVersion, plan.section, plan.desc, repoBase);
  fs.writeFileSync(clPath, nextCl, 'utf8');

  execFileSync('git', ['add', 'package.json', 'CHANGELOG.md'], { cwd: rootDir, stdio: 'inherit' });
  console.log(`[auto-release] Bumped ${prevVersion} -> ${nextVersion} (${plan.bump}) and updated CHANGELOG.md`);

  if (process.env.SKIP_AUTO_VERIFY !== '1') {
    for (const args of [
      ['--check', 'extension.js'],
      ['--check', 'enhance-ide-hook.js'],
      ['--check', 'repair-ide-hook.js'],
      ['--check', 'scripts/package-vsix.mjs'],
      ['--check', 'scripts/release.mjs'],
      ['--check', 'scripts/auto-bump-on-commit.mjs'],
      ['--check', 'scripts/verify-version.mjs'],
      ['scripts/verify-version.mjs'],
      ['--test', 'ide-extension.test.mjs'],
      ['verify-contracts.mjs'],
    ]) {
      execFileSync(process.execPath, args, {
        cwd: rootDir,
        stdio: 'inherit',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
    }
  }

  if (process.env.SKIP_AUTO_BUILD !== '1') {
    execFileSync(process.execPath, ['scripts/package-vsix.mjs'], {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
  }
}

main();
