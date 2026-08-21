# Wayfinder map: plugin-in-subdirs workspace support

label: wayfinder:map

## Destination

A locked spec for the extension/server supporting plugin roots in subdirectories of the opened
folder (e.g. `~/src/dips++-all/` containing `tm-dips-plus-plus/` and `tm-dipspp-editor/`, each
marked by its own `info.toml`): **one server process, N isolated plugin workspaces** — each
`info.toml` directory is its own world (own manifest, own deps, no cross-plugin resolution).
When this map closes, every decision needed to plan and execute the change is written down.

## Notes

- Server repo: `~/src/lsp-openplanet` (Rust, tower-lsp). Extension repo: this repo
  (`packages/vscode-ext`, VS Code API → also VSCodium/Cursor).
- Today: server takes exactly ONE root (`src/server/mod.rs:224` `root_uri`), manifest lookup is
  `root.join("info.toml")` (`mod.rs:161`), client forwards nothing (single-root assumption).
- TDD is the repo expectation (CONTRIBUTING.md); the spec must be testable.
- Per-file rustfmt in the server repo; never `cargo fmt --all`.

## Decisions so far

- [Workspace semantics: one server, N isolated plugin workspaces](tickets/t0-workspace-semantics.md) — each `info.toml` dir is its own world; no cross-plugin resolution.
- [Server workspace-state inventory](tickets/t1-server-workspace-inventory.md) — loaders/config/snapshot are per-root-ready (pure fns); hard parts: URI→workspace routing (~16 handlers), per-workspace rebuild/diagnostic fan-out, config global-vs-per-root split, new downward root scan.
- [Client-side root enumeration inventory](tickets/t3-client-scan-inventory.md) — one `findFiles('**/info.toml', explicit-exclude)` spans all workspace folders (node_modules NOT auto-excluded; pass exclude explicitly); client already sends `workspaceFolders` on the wire but server ignores it (tower-lsp 0.20 carries it — no upgrade needed); discovered roots must be awaited BEFORE `buildInitializationOptions` inside `startClient` (init-options are baked at initialize; no post-start channel exists).

## Not yet specified

- Watched-file semantics: new/removed `info.toml` after init (t1 confirmed NO watched-files/config/workspace-folders handlers exist — roots frozen at init). Can't be ticketed sharply until the root-discovery mechanism (t2) is decided.
- Nested plugin roots (`info.toml` dir containing another `info.toml` dir): rare; revisit
  after discovery + mapping are decided.

## Out of scope

- N-servers / VS Code multi-root-style isolation (rejected at charting: one server, in-process isolation).
- Cross-plugin shared type context or import resolution (rejected: isolation chosen).
- Executing the implementation (wayfinder plans; building happens after the map closes).
