# RUNBOOK ACCEPTANCE LIVE — `antigravity-ide` (`kyuzan0.ag-ide-prompt-enhancer`)

Pembaruan: 2026-11-22 (dipisahkan dari runbook CLI)

## 0) Verifikasi Otomatis Pra-Acceptance (Non-Destruktif)

Jalankan seluruh pemeriksaan otomatis secara independen dari root repositori:

```powershell
node --check extension.js
node --check enhance-ide-hook.js
node --test ide-extension.test.mjs
powershell -ExecutionPolicy Bypass -File install-ide-enhancer.ps1 -WhatIf
```

*(Di Linux tanpa `node` global, gunakan Electron Node bawaan Antigravity IDE: `ELECTRON_RUN_AS_NODE=1 /opt/antigravity-ide/antigravity-ide --test ide-extension.test.mjs`.)*

## 1) Verifikasi Live Antigravity IDE

1. Pastikan salinan ekstensi terpasang sesuai versi aktif di `package.json`:
   - **Windows:** `%USERPROFILE%\.antigravity-ide\extensions\kyuzan0.ag-ide-prompt-enhancer-<version>-universal\` (jalankan `install-ide-enhancer.ps1`), tidak ada folder versi lama maupun legacy `local.antigravity-prompt-enhancer-*`.
   - **Linux / macOS:** Jalankan `./install-ide-enhancer.sh` dan pastikan `~/.antigravity-ide/extensions/kyuzan0.ag-ide-prompt-enhancer-<version>-universal/` terdaftar di `extensions.json`, serta `enhance-ide-hook-config.json` dapat ditulis oleh user IDE.
2. Setelah **Restart penuh** atau **Reload Window**, pastikan:
   - Tidak muncul peringatan *"Your installation appears to be corrupt"* (checksum `product.json` sinkron).
   - Tombol **✦ Enhance Prompt** dan **⚙ Settings** muncul tepat di sebelah kiri tombol **Send (→)** di sidebar chat (`#jetski-frame`).
3. Ketik draf pendek (atau draf dengan `@mention`/chip) pada chat yang sudah memiliki konteks pembahasan, klik **✦** (atau tekan `Ctrl+Alt+E` / `Cmd+Alt+E`), dan pastikan:
   - Draf awal digantikan **tepat satu kali** (tidak dobel dan tidak menyisakan teks lama);
   - Seluruh `@mention` / attachment chip tetap utuh;
   - Hasil enhance relevan dengan workspace dan konteks percakapan aktif;
   - `renderer.log` tidak mencatat error resolusi `--model` maupun kegagalan proxy multi-window.
4. Uji popover **⚙ Settings**: ubah bahasa/detail/shortcut, pastikan badge versi & credit `Created by Kyuzan0` tampil rapi, lalu klik **Open VS Code Settings** dan pastikan membuka ekstensi `@ext:kyuzan0.ag-ide-prompt-enhancer`.
5. Jalankan perintah **`Prompt Enhancer: About & Version Info`** dari Command Palette dan pastikan menampilkan versi aktif beserta opsi membuka `CHANGELOG.md` / GitHub `Kyuzan0`.

## 2) Kebutuhan Model Nyata

Langkah uji live (butir 3) memicu **satu permintaan model nyata** melalui `agy -p` dengan `toolPermission: "strict"`. Pastikan biner native `agy` terpasang dan terautentikasi sebelum menjalankan uji live.
