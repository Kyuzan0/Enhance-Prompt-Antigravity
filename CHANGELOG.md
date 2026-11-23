# Changelog

All notable changes to **Antigravity IDE Prompt Enhancer** (`kyuzan0.ag-ide-prompt-enhancer`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.7] - 2026-11-23

### Changed
- Made **Enhancement** and **Context & Feedback** sections collapsible in Quick Settings (`⚙`) with both collapsed by default and automatic popover repositioning on expand/collapse.

### Fixed
- Added `"when": "config.antigravityPromptEnhancer.shortcutEnabled"` to the `antigravityEnhancer.enhancePrompt` keybinding in `package.json` so `Ctrl+Alt+E` / `Cmd+Alt+E` no longer triggers enhancement when **Enable Shortcut** is turned off.

## [1.4.6] - 2026-11-23

### Added
- Enable/disable toggle (`customInstructionsEnabled`, default `false`) for Custom Instructions in Quick Settings (`⚙`) and VS Code configuration; hides the textarea and omits `<custom_instructions>` from prompts when turned off.

### Fixed
- Fixed stretched toggle switches in Quick Settings (`⚙`) by scoping `.agy-sp-row > label:not(.agy-sp-switch)` and locking `.agy-sp-switch` to `32px × 18px`.

## [1.4.5] - 2026-11-23

### Fixed
- Flush `413 Payload Too Large` HTTP response with `Connection: close` before destroying oversized request sockets (fixes Node 20 `ECONNRESET` in CI).
- Fixed `.github/workflows/release.yml` schema by removing `secrets.*` from step `if:` conditionals and checking `VSCE_PAT` in shell.

## [1.4.4] - 2026-11-23

### Fixed
- Keep the native Agents view connected directly to the hub when Prompt Enhancer is uninstalled, the proxy is still starting, or a Marketplace downgrade replaces it with a proxy that lacks signed iframe support.

## [1.4.3] - 2026-11-23

### Improved
- Aligned Quick Settings (`⚙`) right-column controls (`Shortcut + Reset`, `Output Language`, `Detail Level`, `Preset Mode`) to a uniform `158px` width and `26px` height, added section dividers, modern accessible toggle switches, and viewport-safe `max-height` scrolling.
- Upgraded `Custom Instructions` to a 2-row `<textarea>` with live `N/400` counter, `Clear` action, debounced auto-save, and flush on popover close.
- Fixed status indicator timer overlap & error coloring, added disabled visual state on Shortcut controls when disabled, platform-aware macOS hint, `Undo Last` footer action, live SSE popover sync, toast hover-pause for `Undo`, and red hover indicator + `aria-busy` on the spinning `✦` cancel button.

## [1.4.2] - 2026-11-23

### Fixed
- Restore Agents loading from the native Antigravity webview by allowing signed iframe navigations to the hub while retaining origin checks on enhancer endpoints and WebSocket upgrades.
- Migrate existing iframe hooks during install and repair, preserve their original backups, and keep the native hub URL until the enhancer has a signing token.

## [1.4.1] - 2026-11-23

### Added
- 128×128 extension icon (`assets/icon.png`), `galleryBanner` metadata in `package.json`, and `.png` content-type mapping in `scripts/package-vsix.mjs`.
- Automated GitHub Actions release workflow (`.github/workflows/release.yml`) for GitHub Releases, Open VSX (`OVSX_PAT`), and Visual Studio Marketplace (`VSCE_PAT`).

## [1.4.0] - 2026-11-23

### Added
- 1-click **Undo** button with duration/word-delta metrics in the enhancement status toast, plus `editor.setEditorState` undo tagging.
- Toggle-cancel support for in-flight enhancements (click `✦`, press shortcut, or press `Esc`) wired to `AbortController` and child-process termination.
- Enhancement mode presets (`general`, `debug`, `refactor`, `architecture`) and `customInstructions` setting in both VS Code configuration and the Quick Settings (`⚙`) popover.
- Command `Prompt Enhancer: Show Diagnostics & Health Check` (`antigravityEnhancer.diagnostics`) backed by a dedicated `OutputChannel` and client log ring buffer.
- Cross-platform Linux/macOS installer (`install-ide-enhancer.sh`) and GitHub Actions CI workflow (`.github/workflows/ci.yml`).
- Live HTTP/SSE/WebSocket integration tests, `enhance-ide-hook.js` unit tests, `.vsix` packaging tests, and expanded contract/metadata/Trusted-Types checks in `verify-contracts.mjs`.

### Changed
- Wrapped `buildEnhancePrompt` inputs in explicit `<workspace_context>`, `<untrusted_conversation_context>`, and `<untrusted_draft>` boundaries with closing-tag disarming.
- Sanitized Antigravity session environment variables when spawning `agy -p` and restricted fallback retries strictly to model-not-found errors.
- Updated `serializeLexicalState` to traverse nested Lexical container nodes and broadened `detectDisplayedModel` matching; throttled `MutationObserver` scans during AI streaming.
- Enhanced `scripts/package-vsix.mjs` (`.vscodeignore` negation/root-anchor support, `.vscodeignore` self-exclusion) and `scripts/auto-bump-on-commit.mjs` (runtime-file gating and pre-bump verification).

### Fixed
- Closed CSWSH and loopback port-pivot SSRF gaps on WebSocket `upgrade` and HTTP fallthrough proxy routes, using HMAC-signed `__agy_hub` targets (`__agy_sig`) and timing-safe token verification (`crypto.timingSafeEqual`).
- Blocked cross-port localhost XSSI via `Sec-Fetch-Site: same-site` without valid `Origin`/`Referer`, and added `413 Payload Too Large` + SSE keepalive/error cleanup.
- Fixed Linux case-sensitivity when resolving `CHANGELOG.md` / `changelog.md` from extracted `.vsix` packages.
- Fixed multi-window `enhance-ide-hook-config.json` overwrite race, `loadConfig()` metadata/settings synchronization, and standalone `-VsixPath` installation in `install-ide-enhancer.ps1`.

## [1.3.0] - 2026-11-22

### Added
- add automated release git hook and version bumping script

## [1.2.0] - 2026-11-22

### Added
- Command `Prompt Enhancer: About & Version Info` (`antigravityEnhancer.about`) displaying active version, changelog access, and `Kyuzan0` author credits.
- One-time non-intrusive "What's New" notification when the extension upgrades to a new version.
- Version badge and `by Kyuzan0` credit footer inside the Quick Settings (`⚙`) popover.
- Automated SemVer release and `.vsix` packaging pipeline (`scripts/package-vsix.mjs`, `scripts/release.mjs`) plus `CHANGELOG.md`.
- Standalone `contracts/` (`model-catalog.json`, `strict-deny-policy.json`) and `verify-contracts.mjs`.

### Changed
- Optimized `buildEnhancePrompt` and `extractConversationContext` for token-efficient, low-repetition rewrites and leaner context budgets (`3500` / `3200` chars).
- Promoted Antigravity IDE extension directly to repository root for clean `.vsix` publishing and upgraded `install-ide-enhancer.ps1` to clean up prior version folders and copy `CHANGELOG.md`.

### Fixed
- Hardened loopback proxy against XSSI/CORS token theft (strict origin allow-list, `Cross-Origin-Resource-Policy: same-origin`, `X-Enhancer-Token` enforcement on `/__enhancer/client-log`).
- Fixed `open-vscode-settings` target extension ID, macOS `Cmd+Alt+E` shortcut matching, non-Lexical fallback in `handleEnhanceClick`, and `Ctrl+E` shortcut warning persistence.

## [1.1.0] - 2026-11-19

### Added
- Quick Settings (`⚙`) popover, customizable `Ctrl+Alt+E` / `Cmd+Alt+E` shortcut, `kyuzan0.ag-ide-prompt-enhancer` marketplace metadata, and `.vsix` packaging.

### Fixed
- Automatic `product.json` workbench SHA-256 checksum synchronization to prevent false corrupt-installation warnings.

## [1.0.0] - 2026-11-19

### Added
- Initial release of Antigravity IDE Prompt Enhancer with in-chat **✦ Enhance Prompt** button, loopback reverse proxy, multi-window `__agy_hub` routing, Lexical `@mention`/chip preservation, and strict tool-deny `agy -p` execution.

[Unreleased]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.4.7...HEAD
[1.4.7]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.4.6...v1.4.7
[1.4.6]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.4.5...v1.4.6
[1.4.5]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.4.4...v1.4.5
[1.4.4]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.4.3...v1.4.4
[1.4.3]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/releases/tag/v1.0.0
