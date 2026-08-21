# t1 — Server workspace-state inventory (single-root assumptions)

label: wayfinder:research · status: closed · resolved: 2026-08-21 (research subagent)

## Question

In `~/src/lsp-openplanet`, exactly which code assumes ONE workspace root, and what would each
touch point need for N plugin-root-keyed workspaces? Inventory with `file:line` precision:
`workspace_root` state and every reader; snapshot/workspace load + rebuild triggers
(`PluginWorkspaceLoad`, `analysis_snapshot`); `LspConfig::load(Some(&path))` layering;
`info.toml` manifest diagnostics paths (`server/mod.rs` ~151–170, `server/diagnostics.rs`);
dependency resolution inputs (`workspace/deps.rs` `plugins_dir`); `didOpen`/`didChange`
routing; anything else assuming "the root". Output: touch-point list + risk notes appended
as `## Findings` to this file. No code changes.

## Findings

All paths relative to `~/src/lsp-openplanet/`. Line numbers verified 2026-08-21.

### 1. The `workspace_root` field — every write and reader

Complete set (grep-verified; only 3 uses outside init):

- `src/server/mod.rs:43` — declaration: `workspace_root: tokio::sync::RwLock<Option<PathBuf>>` on `Backend`.
- `src/server/mod.rs:57` — initialized `None` in `Backend::new`.
- `src/server/mod.rs:226` — **the only write**: `initialize()` sets it from `params.root_uri` (`mod.rs:224-230`). Never written again for the life of the process.
- `src/server/mod.rs:79` — read #1: `build_snapshot()` clones it to decide disk-load vs open-docs-only.
- `src/server/mod.rs:160` — read #2: `on_change()` builds "the manifest URI" as `root.join("info.toml")`.

Note: `initialize` ignores `params.workspace_folders` entirely (zero refs to `workspace_folders` in `src/`). `root_uri` is the only root source.

### 2. Workspace load/rebuild machinery

- `PluginWorkspaceLoad` — `src/workspace/load.rs:27-32`: `{ root: PathBuf, files: Vec<WorkspaceSourceFile>, missing_required_dependencies: Vec<String> }`. `root` is singular; one load == one plugin world. Used by LSP and CLI alike.
- `load_plugin_workspace(root, search)` — `load.rs:104-148`: canonicalizes `root` (:108-110), discovers `.as` files via `project::discover_source_files(&root)` (:113, `src/workspace/project.rs:22-41` recursive walk), reads them, then `load_dependency_exports(&root, …)` (:126-130 → `load.rs:204-284`, manifest at `root.join("info.toml")` :210). Pure function of (root, search) — no global state. **Directly reusable per-plugin-root.**
- `merge_open_documents(base, open)` — `load.rs:164-186`: overlays ALL open documents onto the one load; open buffers win by path match (`paths_equal` :188-196). Currently receives every open doc in the process (`Backend::open_documents` `mod.rs:62-71`).
- `AnalysisSnapshot::from_load` — `src/analysis_snapshot.rs:54-73`: builds ONE `files: Vec<SnapshotFile>` + ONE `SymbolTable` (:56, per-file `set_file_symbols` :60, file_id == index invariant :13-14/57) + one missing-deps list. `from_files` (:78-92) is the empty-root fallback (`root: PathBuf::new()`).
- Rebuild triggers — all in `src/server/mod.rs`:
  - `did_open` (:300-305) and `did_change` (:307-313) → `on_change` (:116-201) → `refresh_snapshot` (:110-114) → `build_snapshot` (:77-107): **full disk re-walk + re-read + re-parse + symbol-table rebuild of the whole workspace on every document event** (FULL sync, so every keystroke).
  - `did_close` (:315-320) → `refresh_snapshot` only.
  - **No other triggers exist.** There is NO `didChangeConfiguration`, NO `didChangeWatchedFiles`, NO `didChangeWorkspaceFolders` handler anywhere (grep: 0 matches). Config is loaded exactly once, inside `initialize` (`mod.rs:227`); "settings restart" is not a concept — the only reload path is process restart.
- Snapshot storage: `Backend.snapshot: RwLock<Arc<AnalysisSnapshot>>` (`mod.rs:42`), swapped wholesale by `refresh_snapshot`; initialized empty in `Backend::new` (`mod.rs:53-56`).
- CLI `run_check` builds its own one-shot snapshot (`src/cli/mod.rs:294-322`) — already strictly per-root, unaffected by sharding.

### 3. `LspConfig::load(Some(&path))` layering

`src/config.rs:187-255`. Layers (later wins within the fn):

1. Auto-detect `~/OpenplanetNext` from env (`:201`, `:280-296`).
2. Workspace config: `root.join(".openplanet-lsp.toml")` (`:204-206` → `load_config_file` `:298-305`).
3. User config `~/.config/openplanet-lsp/config.toml` (`:207` → `:307-316`) — applied AFTER workspace file, so user file wins field ties.
4. Init options (`:210-212` → `apply_init_options` `:340-357`) — highest priority.
5. Target-derived defines re-derivation (`:218-220`).
6. **Manifest-derived defines from `root.join("info.toml")`** (`:225-230` → `apply_manifest` `:257-278`: script defines + `DEPENDENCY_*`/`EXPORT_DEPENDENCY_*` per dep). This makes `defines` inherently per-plugin-root.
7. `plugins_dir`/core/game JSON derived from `openplanet_dir` (`:246-251`).

Per-root feasibility: `load` is a pure fn of `(workspace_root, init_options)` — **calling it once per plugin root works today, no signature change needed.** Caveats:

- The result is stored in ONE global `Backend.config: RwLock<LspConfig>` (`mod.rs:35`); `defines`, `plugins_dir`, `source_paths`, `ignore_paths` (config.rs:14, 10, 24, 27) are all inputs that become per-workspace state. Every consumer of `self.config` (`build_snapshot` `mod.rs:78`, `on_change` `mod.rs:118`, `initialize` typedb `mod.rs:233`, `regenerate_type_db` `mod.rs:694`) assumes one config.
- Init options and user config are naturally global; `.openplanet-lsp.toml` + manifest defines are naturally per-root. The merge semantics across N roots (which fields global vs per-root: `game_target`? typedb paths?) is an open spec decision, not a code blocker.
- `UserPrefs::load(workspace_root)` (`config.rs:95-102`) is CLI-only, same shape.

### 4. info.toml manifest diagnostics paths

- `src/server/mod.rs:151-155` — edited URI ending in `info.toml` gets the ONE snapshot's `missing_required_dependencies` appended.
- `src/server/mod.rs:157-189` — edited URI NOT info.toml → diagnostics are ALSO published to the single manifest URI built from `workspace_root.join("info.toml")` (`:160-165`); manifest source = open buffer else disk (`:167-171`); `compute_manifest_diagnostics` (`src/server/diagnostics.rs:51-62`) = TOML diags + `missing_required_dependency_diagnostics` (`diagnostics.rs:33-47`). With N roots this "fan out to the manifest" logic must pick the owning workspace's manifest, and there are N publish targets.
- Filename-based routing: `uri.path().ends_with("info.toml")` at `mod.rs:151`, `mod.rs:157`, `diagnostics.rs:75` — root-agnostic, survives N roots unchanged (per-snapshot missing-deps lists already exist).
- `diagnostics.rs:122-148` `compute_toml_diagnostics` — self-contained; comment at `:126-127` notes export paths can't be validated without a root.
- `Manifest::validate(workspace_root)` — `src/workspace/manifest.rs:87-131`, `root.join(export)` at `:102` and `:112`. Only caller today is its own unit test (`manifest.rs:179`); effectively dormant but encodes root-relative export validation if revived.
- CLI mirror (context, already per-root): `src/cli/mod.rs:302-307`, `:326-336` (`root.join("info.toml")`, `load.root.join("info.toml")`).

### 5. Dependency resolution — `src/workspace/deps.rs`

- `resolve_dependency(dep_id, plugins_dir, plugin_files_search_paths)` `:19-38`: `plugins_dir.join(dep_id)` `:25`, `plugins_dir.join("{dep_id}.op")` `:31`, then directory scans `resolve_by_manifest_module` `:85-116` and `resolve_by_normalized_name` `:50-83` (each `read_dir(plugins_dir)` + `path.join("info.toml")` at `:61`/`:96`).
- `resolve_directory_plugin` `:118-132`: `root.join("info.toml")` `:123` (the dep's own root — per-dep, fine).
- `collect_export_files` `:210-232` + `resolve_plugin_file` `:234-252` (`root.join(file)`, `root.join(search_root).join(file)` — dep-root-relative, fine).
- **Resolution inputs are per-load, not global**: everything flows through `DependencySearch { plugins_dirs, plugin_files_search_paths, source_paths, ignore_paths }` (`load.rs:36-45`), constructed per `build_snapshot` via `with_defaults().finalize_with_config(&config)` (`mod.rs:84-85`, `load.rs:47-76`). One wrinkle: `finalize_with_config` also auto-appends the Steam Trackmania Plugins dir (`load.rs:64-67`, `detect_trackmania_openplanet_plugins_dir` `load.rs:319-324`) — global env, shared by all workspaces either way.
- The only single-root constraint here is upstream: `config.plugins_dir` is ONE `Option<PathBuf>` in the global config (`config.rs:10`). Different plugins could want different plugins dirs; per-root configs solve this for free.
- Sharding verdict: dep resolution is already workspace-scoped by construction — call it per plugin root, nothing in deps.rs changes.

### 6. didOpen/didChange/didClose routing — URI → workspace mapping

- `documents: DashMap<Url, String>` (`mod.rs:38`) — flat, global, no workspace association. Storing text globally is fine; the assumption lives in how it's consumed.
- All three handlers (`mod.rs:300`, `:307`, `:315`) funnel into the single snapshot rebuild; `open_documents()` (`mod.rs:62-71`) feeds **every** open doc into the one `merge_open_documents` call.
- **Nothing maps a document URI to a root today.** The only URI discrimination is `ends_with("info.toml")` filename checks. A URI→workspace index (longest root-path prefix match over canonical roots) is greenfield code.
- Every feature handler reads the single snapshot and does `snapshot.analysis_of(uri)`: completion `mod.rs:322-343`, hover `:345-359`, goto_definition `:361-382`, references `:384-403`, document_highlight `:405-419`, folding `:421-431`, signature `:433-452`, document_symbol `:454-463`, workspace symbol `:465-476`, rename `:478-496`, semantic_tokens `:498-512`, formatting `:514-533` (snapshot-free), inlay_hint `:535-552`, call hierarchy `:554-609`, code_action `:611-629`. Each needs "resolve workspace for this URI, then read that workspace's snapshot."
- Untitled/out-of-root docs: `analysis_of` misses → per-request owned parse fallback (`mod.rs:129-149`, `:332` etc.) — behavior to preserve for docs under no plugin root.

### 7. Symbols table / Snapshot lifecycle — one table or per-workspace?

- ONE `SymbolTable` per `AnalysisSnapshot` (`analysis_snapshot.rs:44-48`, built `:56-67`), and ONE snapshot per Backend (`mod.rs:42`). So today: one table for all files (plugin sources + dep exports + open docs) in the process.
- `SymbolTable` itself (`src/symbols/table.rs:49-63`) is pure `file_id`-keyed storage with global/tail/member indexes — zero workspace awareness, trivially instantiable per workspace. The file_id==index invariant is per-snapshot (`analysis_snapshot.rs:13-14`), so N snapshots = N independent id spaces (fine; ids never cross a snapshot boundary — `GlobalScope` is always built from one snapshot's table, e.g. `mod.rs:333`).
- Lifecycle: empty at `Backend::new` (`mod.rs:53-56`) → wholesale swap on every doc event → dropped with the Backend. No incremental invalidation, no per-file cache (checker runs per request, `checked_file` `analysis_snapshot.rs:143-160`).
- Shard verdict: the snapshot is already a self-contained per-load unit; N workspaces = N `(root, config, snapshot)` triples with per-workspace refresh. No shared mutable state inside the snapshot.

### 8. Everything else assuming "the root"

- `initialize` root intake — `mod.rs:224-230` (single `root_uri`; parent folder in the target scenario has no info.toml, so today the server would treat the PARENT as root: `discover_source_files` walks BOTH plugin subtrees into one workspace with no manifest/deps — exactly the bug being fixed).
- Root discovery only walks UP: `project::find_workspace_root` (`project.rs:4-19`, first `info.toml` wins). Callers: CLI/entrypoint only (`entrypoint.rs:27-29`, `cli/mod.rs:524-537` `resolve_workspace_root`, `cli/watch.rs:198-212` `resolve_root_label`). **No downward scan for child plugin roots exists.**
- No watched-files/config/workspace-folders handlers at all (grep: 0 matches) — roots are frozen at `initialize`; new/removed `info.toml` dirs can't be seen (map.md already flags this as unspecified).
- `PluginWorkspaceLoad.root` singular (`load.rs:28`); empty-path sentinel used when no root (`mod.rs:100`, `analysis_snapshot.rs:80`).
- `type_index: RwLock<Option<Arc<TypeIndex>>>` (`mod.rs:36`) — game typedb, root-independent; correctly stays global (loaded `mod.rs:232-244`, swapped by `regenerate_type_db` `mod.rs:691-728`).
- `spawn_update_check` (`mod.rs:645-689`) — global, root-free.
- CLI watch/check/TUI paths (`cli/mod.rs`, `cli/watch.rs`, `entrypoint.rs`) are single-root by design; they call the shared loaders directly and need no change (regression guard: keep `load_plugin_workspace`'s signature stable).
- Tests touching the single-root surface: `tests/cli_check_tests.rs` (root.join fixtures), `src/server/test_support.rs` (snapshot-per-test, already isolated), `src/workspace/load.rs` tests `:326+` (per-root fixtures).

### Risk notes — easy vs hard to shard

**Easy (mechanical / already parameterized):**

- `load_plugin_workspace` + `DependencySearch` + `deps.rs` — pure per-root functions; N calls, zero changes.
- `AnalysisSnapshot` + `SymbolTable` — self-contained per load; N instances compose.
- `LspConfig::load(Some(root), …)` — free function; per-root calls work now. Per-root `.openplanet-lsp.toml` + manifest defines fall out naturally.
- `documents` map — keep as global text store; partition only when building (filter by root prefix).
- `type_index`, update check — stay global untouched.
- `ends_with("info.toml")` routing + per-snapshot missing-deps — already per-load.
- CLI/watch/entrypoint — untouched (keep loader signature).

**Hard (design work / wide blast radius):**

- **URI→workspace routing**: nothing exists; must add root prefix-matching (canonicalized) plus a fallback for out-of-root/untitled docs, and thread it through ~16 feature handlers in `mod.rs` that today grab the one snapshot. Widest mechanical change; also the natural insertion point for everything else.
- **`on_change` diagnostic fan-out** (`mod.rs:116-201`): rebuilds must become per-owning-workspace (else one keystroke rewalks N×deps), and the manifest-publish block (`:157-189`) must target the owning root's info.toml only. Stale-diagnostic clearing across workspace boundaries needs a rule.
- **Config layering spec**: init options/user config are global; defines/manifest layering is per-root; `plugins_dir`, `source_paths`, `ignore_paths` can differ per plugin. Which fields remain server-global (typedb paths, `game_target`?) is a decision, and `Backend.config` must split into global + per-workspace parts (readers at `mod.rs:78,118,233,694`).
- **Root discovery**: needs a new downward scan (children with info.toml) + lifecycle story; no watched-files handler exists to notice new/removed roots at runtime (map.md "not yet specified").
- **Cross-workspace features**: `workspace/symbol` (`mod.rs:465-476`) spans the snapshot — semantics over N isolated pools (union vs per-query) must be decided; `rename`/`references`/call-hierarchy already snapshot-scoped, so isolation is free once routing exists.
- **Symbol bleed guard**: `merge_open_documents` must take only the owning workspace's open docs, or sibling plugins' buffers pollute the pool (violates the t0 isolation decision).
- **Nested plugin roots** (info.toml under info.toml): discovery must define behavior; current walk-up returns first match, downward scan needs a rule (map.md defers this).
