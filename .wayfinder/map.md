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
- [Root discovery mechanism](tickets/t2-root-discovery-mechanism.md) — hybrid: server walks workspace_folders downward by default (first-match stop, skip hidden/.git/node_modules, depth cap 5; zero-found → single-root fallback on the opened folder = today's behavior); explicit `plugin_roots` init-option overrides the walk. Extension needs no findFiles — just the optional manual `pluginRoots` setting.
- [Stray .as files fallback](tickets/t4-stray-as-files-fallback.md) — no workspace claims strays: existing per-request fallback parse (parse-level features only); composes with t2's zero-found fallback (zero roots → opened-folder workspace serves everything).
- [Per-root config layering](tickets/t5-per-root-config-layering.md) — ladder: auto-detect < parent `.openplanet-lsp.toml` < per-root `.openplanet-lsp.toml` < user config < init options < per-root manifest defines; typedb global phase-1 (game_target/openplanet_dir process-wide, init>user>first-root); defines/plugins_dir/source_paths/ignore_paths per-root.
- [Cross-plugin isolation diagnostics](tickets/t6-cross-plugin-import-diagnostics.md) — no new diagnostic: installed plugins resolve via the normal ladder; fallback appends the opened folder as LAST-priority plugins_dir so a declared dep (dir name in dependencies/optional_dependencies) resolves from the sibling root's exports — same contract as the game runtime, no symbol bleed.
- [Workspace/symbol semantics](tickets/t8-workspace-symbol-semantics.md) — union across all N workspaces, flat result set (search ≠ resolution; paths disambiguate; no active-editor heuristic server-side).
- [Runtime root lifecycle](tickets/t9-runtime-root-lifecycle.md) — phase-1 dynamic: server `didChangeWatchedFiles` for `**/info.toml` (Created/Deleted → re-walk + incremental workspace add/remove; Changed → rebuild owning workspace); extension watcher gains `**/info.toml`; didChangeWorkspaceFolders deferred.
- [Assemble the multi-root spec](tickets/t7-assemble-spec.md) — spec written to docs/superpowers/specs/2026-08-21-multi-root-plugin-workspaces.md: decision table, server state model, routing, client wiring, 9-group TDD list, 5 phases. MAP COMPLETE — destination reached.

## Not yet specified

(none — all fog graduated or resolved; nested-roots fog resolved via t2 walk policy)

## Out of scope

- N-servers / VS Code multi-root-style isolation (rejected at charting: one server, in-process isolation).
- Cross-plugin shared type context or import resolution (rejected: isolation chosen).
- Executing the implementation (wayfinder plans; building happens after the map closes).
