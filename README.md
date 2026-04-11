# lsp-openplanet-ext

A monorepo for wrapping [`openplanet-lsp`](https://github.com/clankercode/lsp-openplanet) — a language server for OpenPlanet AngelScript plugins — into a VSCode extension and npm packages so you can use it from any editor or agentic CLI without needing a Rust toolchain.

## Status

**M1 (Foundation) — ✅ Complete**

The monorepo skeleton, core tooling, and `binary-resolver` package are done. The CI/CD pipeline is fully wired with lint, typecheck, unit tests, and a complete release automation setup that cross-compiles the OpenPlanet LSP binary for six platforms (linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64, win32-arm64).

**Current milestone: M2** — Building the npm CLI wrapper.

## What is `binary-resolver`?

The `binary-resolver` package is the foundation: it abstracts away platform detection and binary discovery. It uses a four-source resolution strategy:

1. **Override path** — allows users to pin a custom LSP binary
2. **VSCode bundle** — looks for `openplanet-lsp` in VSCode extensions (when running as an extension)
3. **Platform-specific npm package** — installs the pre-compiled binary for your platform via `openplanet-lsp-linux-x64`, `openplanet-lsp-darwin-arm64`, etc.
4. **PATH lookup** — falls back to a system-installed `openplanet-lsp` binary

This abstraction is fully tested (TDD coverage) and provides a clean interface for both the npm CLI and the VSCode extension to find and use the LSP binary without worrying about platform differences.

## Packages

| Package                    | Purpose                                      | Status |
| -------------------------- | -------------------------------------------- | ------ |
| `packages/binary-resolver` | Shared binary-path resolution logic          | ✅ M1  |
| `packages/npm-lsp`         | `openplanet-lsp` npm CLI + platform packages | ⏳ M2  |
| `packages/vscode-ext`      | VSCode extension (`openplanet-lsp-vscode`)   | 📋 M4  |
| `packages/grammar`         | AngelScript TextMate grammar                 | 📋 M5  |

## Quick start

```bash
# Install dependencies
pnpm install

# Run the full local CI check (same checks as CI/CD)
just ci

# Or run individual commands
just lint          # Lint and format check
just typecheck     # TypeScript type checking
just test          # Unit tests
just build         # Build all packages
```

## Development

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full workflow (TDD, PR requirements, local setup).

Key targets: `just --list` for all available commands.

The project enforces **CI/local parity**: every check in GitHub Actions is also run by `just ci` locally, so you catch issues before pushing.

## License

[UNLICENSE](./LICENSE) — public domain.
