# lsp-openplanet-ext

A monorepo for wrapping [`openplanet-lsp`](https://github.com/clankercode/lsp-openplanet) — a language server for Openplanet AngelScript plugins — into a VSCode extension and npm packages so you can use it from any editor or agentic CLI without needing a Rust toolchain.

## Editor support

The same [openplanet-lsp server](https://github.com/clankercode/lsp-openplanet)
works across these editors:

| Editor                    | Integration                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| VS Code, VSCodium, Cursor | [This extension](packages/vscode-ext/README.md)                                           |
| Sublime Text              | [LSP package client](https://github.com/clankercode/lsp-openplanet-sublime)               |
| Neovim                    | [Lua plugin and filetype detection](https://github.com/clankercode/lsp-openplanet-neovim) |
| Zed                       | [Native extension](https://github.com/clankercode/lsp-openplanet-zed)                     |
| JetBrains IDEs            | [LSP4IJ integration](https://github.com/clankercode/lsp-openplanet-jetbrains)             |
| Helix                     | [Language configuration](https://github.com/clankercode/lsp-openplanet-helix)             |
| Emacs                     | [Eglot and lsp-mode integration](https://github.com/clankercode/lsp-openplanet-emacs)     |

Each repository includes installation, configuration, troubleshooting, and editor
verification notes. The server can be installed with `npm install -g openplanet-lsp`,
`cargo install openplanet-lsp`, or an archive from its GitHub Releases. Clients
launch `openplanet-lsp --lsp` over stdio. Keep shared plugin settings in
`.openplanet-lsp.toml`; `.as` files are AngelScript and `info.toml` remains TOML.

## VS Code extension

See [the extension README](packages/vscode-ext/README.md) for current features,
settings, commands, and installation requirements. Its runtime resolves an explicit
`openplanetLsp.serverPath`, then a bundled `bin/openplanet-lsp` if present, then
`openplanet-lsp` on `PATH`. It does not download a server at runtime.

The server's published npm package and release archives are maintained in the
[server repository](https://github.com/clankercode/lsp-openplanet).

## What is `binary-resolver`?

The `binary-resolver` package is the foundation: it abstracts away platform detection and binary discovery. It uses a four-source resolution strategy:

1. **Override path** — allows users to pin a custom LSP binary
2. **VSCode bundle** — looks for `openplanet-lsp` in VSCode extensions (when running as an extension)
3. **Platform-specific npm package** — installs the pre-compiled binary for your platform via `openplanet-lsp-linux-x64`, `openplanet-lsp-darwin-arm64`, etc.
4. **PATH lookup** — opt-in fallback to a system-installed `openplanet-lsp` binary (`OPENPLANET_LSP_ALLOW_PATH=1`).

The resolver is tested independently. The current VS Code extension uses its own explicit-path, bundle, and PATH resolution described above.

## Packages

| Package                    | Purpose                                 |
| -------------------------- | --------------------------------------- |
| `packages/binary-resolver` | Shared binary-path resolution library   |
| `packages/vscode-ext`      | VS Code, VSCodium, and Cursor extension |
| `packages/grammar`         | AngelScript TextMate grammar            |

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
