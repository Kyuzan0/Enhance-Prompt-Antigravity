# Changelog

All notable changes to **Antigravity IDE Prompt Enhancer** (`kyuzan0.ag-ide-prompt-enhancer`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Kyuzan0/Enhance-Prompt-Antigravity/releases/tag/v1.0.0
