# lsp-openplanet-ext

VSCode extension and npm package that wrap [`openplanet-lsp`](https://github.com/clankercode/lsp-openplanet) — a language server for OpenPlanet AngelScript plugins — so you can use it from any editor or agentic CLI without needing a Rust toolchain.

## Status

Under development. First milestone (M1 — Foundation) produces the monorepo skeleton, the shared `binary-resolver` package, and a complete CI pipeline. See `docs/superpowers/plans/` for milestone plans.

## Packages

| Package                    | Purpose                                      | Status |
| -------------------------- | -------------------------------------------- | ------ |
| `packages/binary-resolver` | Shared binary-path resolution logic          | M1     |
| `packages/npm-lsp`         | `openplanet-lsp` npm CLI + platform packages | M2/M3  |
| `packages/vscode-ext`      | VSCode extension (`openplanet-lsp-vscode`)   | M4/M6  |
| `packages/grammar`         | AngelScript TextMate grammar                 | M5     |

## Local development

```bash
pnpm install
just ci
```

See `CONTRIBUTING.md` for the full dev workflow and `just --list` for available commands.

## License

[UNLICENSE](./LICENSE) — public domain.
