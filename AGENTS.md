# AGENTS.md

pnpm monorepo for the Openplanet LSP toolchain (grammar, VS Code/VSCodium/Cursor extension, binary resolver). Node ≥20, pnpm 9, `just`.

## Commands

- `pnpm install` — deps
- `just ci` — full local PR gate (lint, format:check, typecheck, test, pkg-shape, CI parity, actionlint)
- `just build-vsix` — package extension to `dist/openplanet-lsp-vscode.vsix` (gitignored)
- `just install-cursor` — dev: build + install VSIX to local Cursor, best-effort window reload

## Conventions

- TDD for non-trivial changes: failing test first (see CONTRIBUTING.md).
- Packages: `packages/grammar`, `packages/vscode-ext`, `packages/binary-resolver` — don't cross-link internals; workspace deps only.
- Extension bundles no server binary; `BINARY_REF` pins the companion `openplanet-lsp` release. Keep extension version in sync with it when shipping binaries.
- Conventional commits (`fix:`, `feat:`, `chore:` …); branch from `main`.
- Run `just ci` before pushing; CI (ci.yml) mirrors it exactly — local pass ≈ CI pass.
- Keep RELEASE.md and CHANGELOG.md updated in the same PR as any release-affecting change.
