#!/usr/bin/env node
/**
 * Zero-dependency cross-platform VSIX packager for ag-ide-prompt-enhancer.
 * Reads package.json & .vscodeignore, generates [Content_Types].xml and
 * extension.vsixmanifest, cleans stale *.vsix builds, and writes <name>-<version>.vsix.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function escapeXml(val) {
  return String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseVscodeIgnore(ignorePath) {
  const rules = [];
  if (!fs.existsSync(ignorePath)) return rules;
  const lines = fs.readFileSync(ignorePath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    const body = negated ? line.slice(1).trim() : line;
    if (!body) continue;
    const rootAnchored = body.startsWith('/');
    const isDir = body.endsWith('/');
    const clean = body.replace(/^\/+/, '').replace(/\/+$/, '').replace(/^\.\//, '');
    if (!clean) continue;
    const regexStr = clean
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');
    rules.push({
      raw: clean,
      negated,
      rootAnchored,
      isDir,
      hasSlash: clean.includes('/'),
      re: new RegExp(`^${regexStr}$`, 'i'),
    });
  }
  return rules;
}

function isIgnored(relPosix, isDirectory, rules) {
  const baseName = path.posix.basename(relPosix);
  if (baseName === '.git' || baseName === 'node_modules' || baseName === '.vscodeignore') return true;
  let ignored = false;
  for (const rule of rules) {
    if (rule.isDir && !isDirectory && !relPosix.startsWith(rule.raw + '/')) {
      continue;
    }
    let matched = false;
    if (rule.rootAnchored || rule.hasSlash) {
      matched = rule.re.test(relPosix) || relPosix.startsWith(rule.raw + '/');
    } else {
      matched = rule.re.test(baseName) || rule.re.test(relPosix);
    }
    if (matched) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

function collectFiles(dir, relPrefix, rules, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (isIgnored(rel, entry.isDirectory(), rules)) continue;
    if (entry.isDirectory()) {
      collectFiles(full, rel, rules, out);
    } else if (entry.isFile()) {
      out.push({ rel, full });
    }
  }
}

// IEEE 802.3 CRC-32 table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

function buildZipBuffer(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const item of entries) {
    const nameBuf = Buffer.from(item.name, 'utf8');
    const raw = Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data, 'utf8');
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const useStore = compressed.length >= raw.length;
    const payload = useStore ? raw : compressed;
    const method = useStore ? 0 : 8;
    const crc = crc32(raw);
    const { dosTime, dosDate } = toDosTimeDate(item.mtime || new Date());

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

function buildContentTypesXml() {
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension=".js" ContentType="application/javascript"/>` +
    `<Default Extension=".json" ContentType="application/json"/>` +
    `<Default Extension=".md" ContentType="text/markdown"/>` +
    `<Default Extension=".png" ContentType="image/png"/>` +
    `<Default Extension=".txt" ContentType="text/plain"/>` +
    `<Default Extension=".vsixmanifest" ContentType="text/xml"/>` +
    `</Types>`
  );
}

function buildVsixManifest(pkg, hasReadme, hasChangelog, hasLicense) {
  const repoUrl = (pkg.repository && typeof pkg.repository === 'object' ? pkg.repository.url : pkg.repository) || '';
  const tags = Array.isArray(pkg.keywords) ? pkg.keywords.join(',') : '';
  const categories = Array.isArray(pkg.categories) ? pkg.categories.join(',') : 'Other';
  const assets = [
    `<Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />`,
  ];
  if (hasReadme) {
    assets.push(`<Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/readme.md" Addressable="true" />`);
  }
  if (hasChangelog) {
    assets.push(`<Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/changelog.md" Addressable="true" />`);
  }
  if (hasLicense) {
    assets.push(`<Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />`);
  }
  const iconRel = typeof pkg.icon === 'string' ? pkg.icon.replace(/^\.\//, '') : '';
  const hasIcon = Boolean(iconRel && fs.existsSync(path.join(rootDir, iconRel)));
  if (hasIcon) {
    assets.push(`<Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${escapeXml(iconRel)}" Addressable="true" />`);
  }

  return `<?xml version="1.0" encoding="utf-8"?>
\t<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
\t\t<Metadata>
\t\t\t<Identity Language="en-US" Id="${escapeXml(pkg.name)}" Version="${escapeXml(pkg.version)}" Publisher="${escapeXml(pkg.publisher)}" />
\t\t\t<DisplayName>${escapeXml(pkg.displayName || pkg.name)}</DisplayName>
\t\t\t<Description xml:space="preserve">${escapeXml(pkg.description || '')}</Description>
\t\t\t<Tags>${escapeXml(tags)}</Tags>
\t\t\t<Categories>${escapeXml(categories)}</Categories>
\t\t\t<GalleryFlags>Public</GalleryFlags>
\t\t\t<Properties>
\t\t\t\t<Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(pkg.engines?.vscode || '^1.80.0')}" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="${escapeXml(repoUrl)}" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Services.Links.Getstarted" Value="${escapeXml(repoUrl)}" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Services.Links.GitHub" Value="${escapeXml(repoUrl)}" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Services.Links.Support" Value="${escapeXml(pkg.bugs?.url || '')}" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Services.Links.Issues" Value="${escapeXml(pkg.bugs?.url || '')}" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Services.Links.Learn" Value="${escapeXml(pkg.homepage || '')}" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
\t\t\t\t<Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
\t\t\t</Properties>
\t\t\t${hasLicense ? '<License>extension/LICENSE.txt</License>' : ''}
\t\t\t${hasIcon ? `<Icon>extension/${escapeXml(iconRel)}</Icon>` : ''}
\t\t</Metadata>
\t\t<Installation>
\t\t\t<InstallationTarget Id="Microsoft.VisualStudio.Code"/>
\t\t</Installation>
\t\t<Dependencies/>
\t\t<Assets>
\t\t\t${assets.join('\n\t\t\t')}
\t\t</Assets>
\t</PackageManifest>`;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const keepOld = args.has('--keep-old');

  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  if (!pkg.name || !pkg.publisher || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(pkg.version || ''))) {
    throw new Error(`Invalid package.json metadata: name=${pkg.name}, publisher=${pkg.publisher}, version=${pkg.version}`);
  }

  const buildDir = path.join(rootDir, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  const outName = `${pkg.name}-${pkg.version}.vsix`;
  const outPath = path.join(buildDir, outName);

  if (!keepOld) {
    for (const file of fs.readdirSync(buildDir)) {
      if ((file.startsWith(`${pkg.name}-`) && file.endsWith('.vsix') && file !== outName) || file === 'SHA256SUMS.txt') {
        fs.rmSync(path.join(buildDir, file), { force: true });
        console.log(`[package-vsix] Removed stale artifact: build/${file}`);
      }
    }
    for (const file of fs.readdirSync(rootDir)) {
      if (file.startsWith(`${pkg.name}-`) && file.endsWith('.vsix')) {
        fs.rmSync(path.join(rootDir, file), { force: true });
        console.log(`[package-vsix] Removed legacy root artifact: ${file}`);
      }
    }
  }

  const rules = parseVscodeIgnore(path.join(rootDir, '.vscodeignore'));
  const files = [];
  collectFiles(rootDir, '', rules, files);

  const zipEntries = [];
  let hasReadme = false;
  let hasChangelog = false;
  let hasLicense = false;

  for (const f of files) {
    let targetRel = f.rel;
    if (f.rel === 'README.md') {
      targetRel = 'readme.md';
      hasReadme = true;
    } else if (f.rel === 'CHANGELOG.md') {
      targetRel = 'changelog.md';
      hasChangelog = true;
    } else if (f.rel === 'LICENSE') {
      targetRel = 'LICENSE.txt';
      hasLicense = true;
    }
    const stat = fs.statSync(f.full);
    zipEntries.push({
      name: `extension/${targetRel}`,
      data: fs.readFileSync(f.full),
      mtime: stat.mtime,
    });
  }

  zipEntries.unshift(
    { name: 'extension.vsixmanifest', data: buildVsixManifest(pkg, hasReadme, hasChangelog, hasLicense) },
    { name: '[Content_Types].xml', data: buildContentTypesXml() }
  );

  const zipBuf = buildZipBuffer(zipEntries);
  fs.writeFileSync(outPath, zipBuf);

  const sha256 = crypto.createHash('sha256').update(zipBuf).digest('hex');
  fs.writeFileSync(path.join(buildDir, 'SHA256SUMS.txt'), `${sha256}  ${outName}\n`, 'utf8');
  console.log(`[package-vsix] Built build/${outName} (${zipBuf.length} bytes, ${zipEntries.length} entries)`);
  console.log(`[package-vsix] SHA-256: ${sha256}`);
  console.log('[package-vsix] Wrote build/SHA256SUMS.txt');
  for (const e of zipEntries) {
    console.log(`  - ${e.name}`);
  }
}

main();
