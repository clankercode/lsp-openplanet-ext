# Multi-root plugin workspace support — spec

Date: 2026-08-21 · Status: locked (wayfinder map `.wayfinder/map.md`, all tickets closed)
Scope: `~/src/lsp-openplanet` (server) + `~/src/lsp-openplanet-ext/packages/vscode-ext` (client)

## Goal

Opening a folder like `~/src/dips++-all/` that contains several plugin subdirectories
(`tm-dips-plus-plus/`, `tm-dipspp-editor/`, each with its own `info.toml`) gives full LSP
support per plugin: each `info.toml` dir is an **isolated workspace** — own manifest, own
deps, own diagnostics. Today the server treats the opened folder as one root, merges both
plugin subtrees into one manifest-less workspace (verified bug), and Neovim/helix get the
same failure.

**Model: one server process, N isolated plugin workspaces.**

## Decisions (locked)

| # | Decision | Summary |
|---|----------|---------|
| t0 | Workspace semantics | One server, N isolated workspaces; no cross-plugin resolution or shared type context. |
| t2 | Root discovery | Hybrid: server walks `workspace_folders` downward by default; explicit `plugin_roots` init-option overrides. Walk: first-match stop (dir with `info.toml` = root, don't descend), skip hidden/`.git`/`node_modules`, depth cap 5. Zero found → single-root fallback on the opened folder (today's behavior). |
| t4 | Stray `.as` files | No workspace claims them: existing per-request fallback parse (parse-level features only). `untitled:` same. |
| t5 | Config layering | auto-detect < parent (opened-folder) `.openplanet-lsp.toml` < per-root `.openplanet-lsp.toml` < user config < init options < per-root manifest defines. Typedb **global** phase-1: `game_target`/`openplanet_dir` process-wide (init > user > first-root). `defines`/`plugins_dir`/`source_paths`/`ignore_paths` per-root. |
| t6 | Cross-plugin resolution | No new diagnostic. Installed plugins resolve via the normal ladder (unchanged). Fallback: the opened folder is appended as **last-priority** `plugins_dir`, so a dep whose id matches a sibling **directory name** declared in A's `dependencies`/`optional_dependencies` resolves from the sibling's `info.toml` + declared exports (same contract as the game runtime — no symbol bleed). |
| t8 | workspace/symbol | Union across all N workspaces, flat result set (search ≠ resolution; file paths disambiguate). |
| t9 | Runtime lifecycle | Phase-1 dynamic: server `didChangeWatchedFiles` for `**/info.toml` — Created/Deleted → re-walk + incremental workspace add/remove; Changed → rebuild owning workspace. Extension watcher gains `**/info.toml`. `didChangeWorkspaceFolders` deferred. |

Out of scope: N-server isolation, cross-plugin shared type context, per-workspace typedb,
`didChangeWorkspaceFolders`.

## Server state model

```
Backend {
  workspaces: RwLock<Vec<PluginWorkspace>>,   // one per effective root
  type_index: RwLock<Option<Arc<TypeIndex>>>, // stays GLOBAL (t5)
  documents: DashMap<Url, String>,            // text store, unchanged
}
PluginWorkspace {
  root: PathBuf,                              // canonicalized dir containing info.toml
  config: LspConfig,                          // per-root layered (t5)
  snapshot: Arc<AnalysisSnapshot>,            // own SymbolTable + file ids (t1: shards cleanly)
}
```

- `PluginWorkspaceLoad` / `load_plugin_workspace` / `merge_open_documents` are reused
  per-root unchanged (t1: pure functions). `merge_open_documents` must receive **only the
  owning workspace's** open documents (path-prefix filter) — symbol-bleed guard.
- Single-root case (N=1) collapses to today's behavior exactly.

### Document → workspace mapping

Canonicalized longest-root-path prefix match over `workspaces[*].root`. No match →
per-request fallback parse (t4). `info.toml` docs route to their own workspace (filename
routing `ends_with("info.toml")` stays; the owning root replaces `workspace_root.join(...)`).

### Feature handler routing

All ~16 handlers (`completion` … `code_action`, mod.rs) resolve the workspace for the
request URI, then read that workspace's snapshot. `workspace/symbol` queries all N and
merges (t8). Requests for out-of-workspace docs keep the existing per-request fallback
(parse-level answers).

### Rebuilds & diagnostics

- `on_change(uri)`: rebuild **only the owning workspace** (today: full rewalk of the one
  workspace — with N workspaces, per-workspace rebuild, not N×everything).
- Manifest diagnostics fan out to the **owning workspace's** `info.toml` only
  (mod.rs:157-189 today assumes the single root).
- `missing_required_dependencies` stay per-workspace.

## Discovery & lifecycle flow

1. `initialize`: effective roots = `config.plugin_roots` (init-option, if non-empty) else
   `discover_plugin_roots(workspace_folders paths)` (fallback `root_uri`); zero found →
   `[first folder]`. N=1 → also set `workspace_root` (back-compat, fixes parent-as-root bug).
2. Per root: load config (t5 ladder) → `load_plugin_workspace` → snapshot; first
   diagnostics publish.
3. `didChangeWatchedFiles(**/info.toml)`: Created/Deleted → re-derive effective roots
   (explicit override frozen) → diff → add (load + publish) / remove (drop + clear that
   workspace's diagnostics). Changed → rebuild owning workspace.

## Client wiring (vscode-ext)

- New setting `openplanetLsp.pluginRoots: string[]` (default `[]`): forwarded as
  `plugin_roots` init-option **only when non-empty** (precedence contract: unset forwards
  nothing → server auto-walk keeps control).
- Watcher: `fileEvents` gains `**/info.toml` next to `**/*.as`.
- No `findFiles` scan needed (server owns discovery).

## TDD test list (RED first)

Server:
1. `discover_plugin_roots`: info.toml at folder root; one subdir; two siblings;
   nested-outer-wins; skip `.git`/`node_modules`/hidden; depth-cap-6-not-found;
   nonexistent input; zero-found caller fallback.
2. Config: `plugin_roots` parse (empty/absent → no override); parent-then-root layering;
   manifest defines per-root.
3. initialize: single-plugin tree via workspace_folders → `workspace_root` = plugin dir
   (not the opened parent) — the original bug as RED test.
4. Routing: `.as` in root A resolves A's symbols, not B's; stray `.as` → fallback
   (parse-level only); `info.toml` diagnostics go to the owning manifest URI.
5. t6 sibling-dep: A declares sibling dir in `dependencies` → A's import of B's export
   resolves from the workspace tree; NOT declared → unresolved (isolation pinned);
   installed copy wins over sibling tree.
6. t8 union: symbol query hits both roots.
7. t9: info.toml create/delete → workspace added/removed (+ diagnostics cleared);
   info.toml edit → owning workspace rebuilt, others untouched.

Client:
8. `buildInitializationOptions`: pluginRoots unset/empty → key absent; non-empty →
   forwarded verbatim.
9. Watcher forwards `**/info.toml` (client-side wiring test where feasible).

## Implementation phases

1. Discovery + pluginRoots + N=1 fix (subagents already dispatched).
2. N-workspace Backend sharding + routing + per-workspace rebuild/diagnostics.
3. t5 config layering; t6 sibling-dep fallback.
4. t9 watched-files lifecycle (server handler + client watcher widening).
5. t8 union last (falls out of routing).
