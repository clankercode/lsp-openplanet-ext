# Openplanet LSP for VS Code

Language support for [Openplanet](https://openplanet.dev) AngelScript plugins, powered by
[openplanet-lsp](https://github.com/clankercode/lsp-openplanet): diagnostics, completions,
hover, go-to-definition/references, rename, document/workspace symbols, signature help,
formatting, inlay hints, folding, call hierarchy, and semantic tokens.

## Requirements

The extension needs the `openplanet-lsp` binary. It is resolved in this order:

1. **`openplanetLsp.serverPath`** — absolute path you set explicitly.
2. **Bundled binary** — platform VSIX builds ship it in `bin/`.
3. **`openplanet-lsp` on your PATH** — e.g. `npm install -g openplanet-lsp`.

If none is found the extension shows an error with a shortcut to the settings; the log
channel (_Output → Openplanet LSP_) shows exactly what was tried.

## Settings

| Setting                       | Default       | Description                                        |
| ----------------------------- | ------------- | -------------------------------------------------- |
| `openplanetLsp.serverPath`    | `""`          | Absolute path to the binary override.              |
| `openplanetLsp.openplanetDir` | `""`          | Openplanet install dir (auto-detected when empty). |
| `openplanetLsp.pluginsDir`    | `""`          | Plugins dir (auto-detected when empty).            |
| `openplanetLsp.gameTarget`    | `"TMNEXT"`    | Which game's `#if` platform branches are compiled. |
| `openplanetLsp.signatureMode` | `"developer"` | Signature level whose `SIG_*` defines are live.    |
| `openplanetLsp.defines`       | `[]`          | Extra preprocessor defines (added, not replaced).  |

**Precedence:** the server layers configuration as auto-detect → workspace
`.openplanet-lsp.toml` → user config → VS Code settings. The extension only forwards
settings you actually set (non-empty); anything left at its default is **not** sent, so a
repo's `.openplanet-lsp.toml` stays in control for your teammates.

`gameTarget` selects the preprocessor defines the LSP compiles with — set it to the game
your plugin targets so dead `#if MP4` / `#if TURBO` branches are treated as dead, exactly
like the real game does. Changing settings restarts the server automatically (they are
read at initialize time).

`signatureMode` does the same for the signature defines. Openplanet defines a signature
macro when the current level is equal or **below** that macro's level, so the levels are
cumulative — `official` gives `SIG_OFFICIAL`, `regular` adds `SIG_REGULAR`, `school` adds
`SIG_SCHOOL`, and `developer` (the default) gives all four. Narrow it to check your plugin
the way it compiles once signed: `#if SIG_DEVELOPER` blocks go dead below `developer`.

`defines` is **additive** — entries are added on top of what the game target and signature
level derive, plus `info.toml` `[script].defines`. Prefix an entry with `-` or `!` to turn
one off (`-LOGS`).

## Commands

- **Openplanet LSP: Restart Server** — restart the language server.

## Untrusted workspaces

Functionality is limited in untrusted workspaces: the server reads workspace files, and
`openplanetLsp.serverPath` can point at any executable — review it before trusting.

## License

[Unlicense](https://unlicense.org) — same as openplanet-lsp.
