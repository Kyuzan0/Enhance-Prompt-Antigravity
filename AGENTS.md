# AGENTS.md — Antigravity IDE Prompt Enhancer (`kyuzan0.ag-ide-prompt-enhancer`)

Instruksi kerja wajib bagi AI coding agent saat memodifikasi proyek ini.

## 1. Batas Workspace & Identitas
- Proyek ini berdiri independen khusus untuk **Antigravity IDE**. Jangan memodifikasi proyek sibling `../agy-cli` kecuali diminta secara eksplisit oleh pengguna.
- **`package.json`** adalah *single source of truth* untuk versi (SemVer) dan metadata ekstensi. Jangan melakukan hardcode string versi di `extension.js`, `enhance-ide-hook.js`, `install-ide-enhancer.ps1`, atau dokumentasi.
- Pertahankan `"publisher": "kyuzan0"` dan atribusi author **`Kyuzan0`** (`https://github.com/Kyuzan0`).

## 2. Alur Wajib Setiap Ada Perubahan Kode
Setiap perubahan fungsional pada `extension.js`, `enhance-ide-hook.js`, `install-ide-enhancer.ps1`, atau `package.json` **wajib** diikuti oleh:
1. **Update `CHANGELOG.md` & Bump Versi (SemVer):**
   - Catat perubahan di bawah `## [Unreleased]` pada `CHANGELOG.md`, lalu jalankan rilis:
     - `node scripts/release.mjs patch` (bugfix / refactor / optimasi), atau `minor` (fitur baru), atau `major` (*breaking change*).
   - *(Jika `git commit` dijalankan langsung tanpa `release.mjs`, `.githooks/commit-msg` akan otomatis menaikkan versi, mengisi `CHANGELOG.md`, dan membangun `.vsix` berdasarkan pesan Conventional Commit. Gunakan `SKIP_AUTO_RELEASE=1` hanya bila memang ingin melewati bump.)*
2. **Verifikasi Penuh Sebelum Selesai:**
   - Jalankan `npm run verify` (atau via Electron Node Linux: `ELECTRON_RUN_AS_NODE=1 /opt/antigravity-ide/antigravity-ide --test ide-extension.test.mjs` dan `verify-contracts.mjs`).
3. **Rebuild `.vsix` Bersih:**
   - Pastikan paket `ag-ide-prompt-enhancer-<version>.vsix` terbaru selesai dibangun (`scripts/package-vsix.mjs`) dan versi lama sudah dibersihkan.

## 3. Aturan Git Hook (`.githooks/commit-msg`)
- Aktifkan di clone baru dengan `npm run hooks:install` (`git config core.hooksPath .githooks`).
- Pemetaan otomatis saat commit:
  - `feat:` → bump `minor` (`### Added`)
  - `fix:` → bump `patch` (`### Fixed`)
  - `perf:` / `refactor:` → bump `patch` (`### Changed`)
  - `!:` atau `BREAKING CHANGE` → bump `major` (`### Changed`)
  - `docs:` / `chore:` / `test:` / `ci:` / `chore(release):` → tidak menaikkan versi.
- Memiliki guard anti *double-bump*: jika `package.json` `"version"` sudah di-bump oleh `scripts/release.mjs`, hook otomatis dilewati.

## 4. Invarian Keamanan & Kualitas
- Pertahankan validasi origin ketat (`isAllowedEnhancerOrigin`, `isAllowedEnhancerRequest`, `Cross-Origin-Resource-Policy: same-origin`) dan token check di `extension.js`; jangan pernah membuka `Access-Control-Allow-Origin: *`.
- `enhance-ide-hook.js` harus tetap *Trusted-Types safe* (DOM API murni, tanpa `innerHTML` atau `eval`).
- Pertahankan efisiensi token pada `buildEnhancePrompt` (anti-repetisi riwayat chat, batas konteks `3500` / `3200`, tanpa glosarium bilingual berlebihan).
- Jangan memasukkan file test/dev (`*.test.*`, `scripts/`, `contracts/`, `.githooks/`, `AGENTS.md`) ke dalam `.vsix` (jaga `.vscodeignore`).
