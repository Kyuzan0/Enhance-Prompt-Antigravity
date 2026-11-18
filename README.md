# agy — Antigravity CLI & IDE Prompt Enhancer

Portable prompt-enhancement toolkit for **Antigravity IDE** and **Antigravity CLI (`agy`)**.

## Overview & Architecture

The repository provides modular integration layers depending on whether you work inside **Antigravity IDE** or the **Antigravity CLI (`agy`)** terminal:

1. **Antigravity IDE Extension + Local Reverse Proxy (`scripts/prompt-enhancer/ide-extension/`)**
   - VS Code-compatible extension (`local.antigravity-prompt-enhancer`) that places a **✦ Enhance Prompt** button and **⚙ Settings** button directly to the left of the **Send (→)** button in the IDE chat sidebar (`antigravity.panel`), preserving Lexical `@mentions` and attachment chips.
   - Supports a customizable keyboard shortcut (`Ctrl+Alt+E` / `Cmd+Alt+E` by default, configurable via Quick Settings popover or VS Code Keybindings `antigravityEnhancer.enhancePrompt`), persistent settings (`antigravityPromptEnhancer.*`), and an inline Quick Settings popover (`⚙`).
   - Because Antigravity IDE renders its chat inside a cross-origin `<iframe id="jetski-frame">` served by `agy --hub`, [extension.js](scripts/prompt-enhancer/ide-extension/extension.js) runs an HTTP + WebSocket loopback reverse proxy (default preferred port `47831`, isolated per window via `__agy_hub` query/Referer/cookie) to inject [enhance-ide-hook.js](scripts/prompt-enhancer/ide-extension/enhance-ide-hook.js), anchor prompts to active workspace & chat context, and invoke the native CLI (`agy -p`) with strict tool-deny settings. Self-heals patched IDE HTML/extension hooks on startup after IDE updates.
2. **Antigravity CLI Plugin (`plugins/prompt-enhancer/`)**
   - `PreInvocation` lifecycle plugin ([plugin.json](plugins/prompt-enhancer/plugin.json), [hooks.json](plugins/prompt-enhancer/hooks.json), [hook.mjs](plugins/prompt-enhancer/hook.mjs)) and `/enhance` skill ([SKILL.md](plugins/prompt-enhancer/skills/enhance/SKILL.md)).
3. **Go ConPTY CLI Wrapper (`scripts/prompt-enhancer/wrapper/`)**
   - Standalone Go wrapper (`module ctrle-interceptor`) wrapping native `agy-real.exe` in Windows ConPTY to support interactive terminal `Ctrl+E`, `Ctrl+G`, and `!`/`/enhance` draft replacement with paste-chip protection (`build.ps1`).
4. **Standalone Engine, Hook Specification & Legacy Daemon (`scripts/prompt-enhancer/`)**
   - Modular core engine ([prompt-enhancer.mjs](scripts/prompt-enhancer/prompt-enhancer.mjs) / `.ts`), fail-closed `PreInvocation` contract verifier ([hook.mjs](scripts/prompt-enhancer/hook.mjs)), CLI helper ([enhance.mjs](scripts/prompt-enhancer/enhance.mjs)), and deprecated WinForms hotkey daemon scripts ([manage-daemon.ps1](scripts/prompt-enhancer/manage-daemon.ps1)).

## Prerequisites

- **Node.js**: `>= 18` (ESM, `fetch`)
- **PowerShell**: `5.1` or `7+` (for Windows install/build scripts)
- **Antigravity CLI (`agy`)**: Installed on the host (`~/.gemini/bin/agy.exe` or in `PATH`)
- **Antigravity IDE** *(for IDE integration)*: Installed in standard user/system path or set via `ANTIGRAVITY_IDE_APP_ROOT`
- **Go**: `>= 1.22` *(only required if building or modifying `scripts/prompt-enhancer/wrapper/` from source)*

## Repository Layout

| Path | Content |
|---|---|
| `plugins/prompt-enhancer/` | Antigravity CLI plugin source (`plugin.json`, `hooks.json`, `hook.mjs`, `config.json`, `config.example.json`, `install-plugin.ps1`, `skills/enhance/SKILL.md`) |
| `scripts/prompt-enhancer/ide-extension/` | Antigravity IDE extension (`package.json`, `extension.js`, `enhance-ide-hook.js`, `install-ide-enhancer.ps1`) |
| `scripts/prompt-enhancer/wrapper/` | Go ConPTY wrapper production source (`main.go`, `enhancer.go`, `composer.go`, `live_span.go`, `editor_bridge.go`, `renderer.go`, `span_commit.go`, `build.ps1`) |
| `scripts/prompt-enhancer/` | Standalone engines (`prompt-enhancer.mjs`/`.ts`), fail-closed `hook.mjs`, `enhance.mjs`, and legacy daemon scripts (`daemon.ps1`, `manage-daemon.ps1`, `PromptEnhancerApp.cs`) |
| `scripts/goa/activate-prompt-enhancer.ps1` | Transactional GOA activator (lock-checked backup + `File.Replace` rollback) |
| `LICENSE` | MIT License |

> **Note:** Test files/fixtures, subdirectory `README.md`s, local runbooks/captures, logs, compiled `.exe` binaries, and `.bak` files are excluded via `.gitignore`.

## Quick Start (After `git clone`)

### 1. Antigravity IDE Extension (✦ Button Next to Send)

```powershell
# Optional dry-run first
powershell -ExecutionPolicy Bypass -File scripts/prompt-enhancer/ide-extension/install-ide-enhancer.ps1 -WhatIf

# Install extension and hook patches (idempotent)
powershell -ExecutionPolicy Bypass -File scripts/prompt-enhancer/ide-extension/install-ide-enhancer.ps1
```

Then run **`Developer: Reload Window`** (`Ctrl+Shift+P`) inside Antigravity IDE.

- **Keyboard Shortcut**: Press **`Ctrl+Alt+E`** (`Cmd+Alt+E` on macOS) inside the chat input box (or trigger `Prompt Enhancer: Enhance Active Prompt` from the Command Palette).
- **Quick Settings UI**: Click the **⚙** icon next to the **✦** button (or run `Prompt Enhancer: Open Settings`) to customize the shortcut, output language, detail level, context toggles, and status toast—all persisted to VS Code User Settings.

### 2. Antigravity CLI Plugin (`plugins/prompt-enhancer/`)

```powershell
# Copy plugin & skill into %USERPROFILE%\.gemini\config\plugins\prompt-enhancer
powershell -ExecutionPolicy Bypass -File plugins/prompt-enhancer/install-plugin.ps1

# Or via agy CLI plugin command if supported by your build:
agy plugin install ./plugins/prompt-enhancer
```

### 3. Go ConPTY CLI Wrapper *(Optional, Windows CLI `Ctrl+E`)*

```powershell
# Build only (no installed binary modified)
powershell -ExecutionPolicy Bypass -File scripts/prompt-enhancer/wrapper/build.ps1

# Build and deploy safely (requires native agy-real.exe or ~/.gemini/bin/agy.exe)
powershell -ExecutionPolicy Bypass -File scripts/prompt-enhancer/wrapper/build.ps1 -Deploy
```

## Configuration & Environment Variables

| Variable / Setting | Default | Description |
|---|---|---|
| `antigravityPromptEnhancer.shortcutEnabled` | `true` | Enable keyboard shortcut trigger inside the IDE chat input box. |
| `antigravityPromptEnhancer.shortcut` | `Ctrl+Alt+E` | Custom shortcut to trigger Enhance Prompt directly inside the chat input box. |
| `antigravityPromptEnhancer.outputLanguage` | `auto` | Output language for enhanced prompts (`auto`, `id`, `en`). |
| `antigravityPromptEnhancer.detailLevel` | `balanced` | Output detail level (`concise`, `balanced`, `comprehensive`). |
| `antigravityPromptEnhancer.includeWorkspaceContext` | `true` | Include workspace structure, manifests, and open tabs in enhancement context. |
| `antigravityPromptEnhancer.includeConversationContext` | `true` | Include recent active chat messages when resolving references. |
| `antigravityPromptEnhancer.showToast` | `true` | Show status toast pill on completion or error inside the chat panel. |
| `AGY_ENHANCER_PORT` / `antigravityPromptEnhancer.proxyPort` | `47831` | Preferred loopback port for the IDE extension proxy (falls back to ephemeral `0` if busy). |
| `AGY_CLI_BIN` / `antigravityPromptEnhancer.cliPath` | Auto (`~/.gemini/bin/agy*`) | Override path to the native Antigravity CLI binary. |
| `AGY_ENHANCER_TIMEOUT_MS` / `antigravityPromptEnhancer.timeoutMs` | `60000` | Subprocess timeout (ms) for `agy -p` inside the IDE extension. |
| `ANTIGRAVITY_EXTENSIONS_DIR` | `%USERPROFILE%\.antigravity-ide\extensions` | Target folder used by `install-ide-enhancer.ps1` (`-ExtensionRoot`). |
| `ANTIGRAVITY_IDE_APP_ROOT` | Auto-detected | Target `resources\app` path for Antigravity IDE (`-IdeAppRoot`). |
| `AGY_CONFIG_DIR` | `%USERPROFILE%\.gemini\config` | Target CLI config root used by `install-plugin.ps1`. |
| `AGY_BIN_DIR` | `%LOCALAPPDATA%\agy\bin` | Target CLI binary directory used by `wrapper/build.ps1` & `activate-prompt-enhancer.ps1`. |
| `PROMPT_ENHANCER_CONFIG` | Plugin/script local config | Custom JSON config path for `hook.mjs` (see `plugins/prompt-enhancer/config.example.json`). |
| `PROMPT_ENHANCER_MODE` | `hybrid` | `hybrid`, `llm`, or `local` (deterministic fallback). |
| `PROMPT_ENHANCER_MODEL` | Active session model | Optional explicit model ID override for CLI plugin hook. |

## Verification

```powershell
# Syntax check JS/MJS sources
node --check scripts/prompt-enhancer/ide-extension/extension.js
node --check scripts/prompt-enhancer/ide-extension/enhance-ide-hook.js
node --check scripts/prompt-enhancer/enhance.mjs
node --check scripts/prompt-enhancer/hook.mjs
node --check plugins/prompt-enhancer/hook.mjs

# Dry-run installers & lifecycle scripts safely
powershell -ExecutionPolicy Bypass -File scripts/prompt-enhancer/ide-extension/install-ide-enhancer.ps1 -WhatIf
powershell -ExecutionPolicy Bypass -File plugins/prompt-enhancer/install-plugin.ps1 -WhatIf

# Verify Go wrapper compiles cleanly
pushd scripts/prompt-enhancer/wrapper
go build -o "$env:TEMP\agy-verify.exe" .
Remove-Item "$env:TEMP\agy-verify.exe" -Force -ErrorAction SilentlyContinue
popd
```

## License

Licensed under the [MIT License](LICENSE).

## Uninstall & Rollback

- **Antigravity IDE Extension**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/prompt-enhancer/ide-extension/install-ide-enhancer.ps1 -Uninstall
  ```
  Restores `workbench.html`, `workbench-jetski-agent.html`, and `extensions\agy\vscode\extension.js` from `.enhancer.bak`, removes injected scripts, and unregisters the extension.
- **Antigravity CLI Plugin**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File plugins/prompt-enhancer/install-plugin.ps1 -Uninstall
  ```
- **Go ConPTY Wrapper**: Restore native `agy-real.exe` to `%LOCALAPPDATA%\agy\bin\agy.exe` (or restore from the timestamped `backup_build_deploy_*` directory created by `build.ps1 -Deploy`).
