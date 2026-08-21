# t3 — Client-side root enumeration inventory

label: wayfinder:research · status: closed · resolved: 2026-08-21 (research subagent)

## Question

How should `packages/vscode-ext` enumerate plugin roots at activation, and what does the
client transport support? Cover: `vscode.workspace.findFiles('**/info.toml', exclude)` —
default excludes (`**/node_modules/**`, `.git`), behavior with 0 hits / huge trees;
multi-folder workspaces (`workspace.workspaceFolders` — one findFiles per folder?);
whether Cursor/VSCodium behave identically (same VS Code API); what the server's `initialize`
already accepts (`root_uri` single, `workspace_folders` — does tower-lsp/our Backend read
it? cross-check `src/server/mod.rs`); and how `initializationOptions` could carry an explicit
root list (settings.ts precedence contract: unset forwards nothing). Output: `## Findings`
appended to this file. No code changes.

## Findings

Status: resolved. All line refs verified against the working trees on 2026-08-21.
Versions in play: `@types/vscode` 1.115.0, `vscode-languageclient` 9.0.1 (installed under
`packages/vscode-ext/node_modules/`); server `tower-lsp` 0.20 → `lsp-types` 0.94.1
(`~/src/lsp-openplanet/Cargo.toml:28`; `tower-lsp-0.20.0/Cargo.toml:59-60` pins
`lsp-types = "0.94.1"`; `Cargo.lock:1165-1166` resolves lsp-types 0.94.1).

### 1. `vscode.workspace.findFiles` semantics

Source of truth: `node_modules/@types/vscode/index.d.ts:14081-14098`.

- **Signature**: `findFiles(include: GlobPattern, exclude?: GlobPattern | null, maxResults?: number, token?: CancellationToken): Thenable<Uri[]>` (index.d.ts:14098). Async, off the renderer thread — the API docs note glob-based finding "perform[s] well and run[s] _outside_" the UI (index.d.ts:13799, in the watcher/glob preamble).
- **Default excludes** (index.d.ts:14090-14092, verbatim): "When `undefined`, default file-excludes (e.g. the `files.exclude`-setting **but not `search.exclude`**) will apply. When `null`, no excludes will apply."
  - Consequence: `node_modules` is **NOT** auto-excluded. VS Code's default `files.exclude` hides dotfiles (`.git`, `.svn`, `.hg`, `.DS_Store`, …) only; `node_modules`/`bower_components` live in `search.exclude`, which `findFiles` explicitly ignores. The API's own doc example passes the exclude explicitly: `findFiles('**/*.js', '**/node_modules/**', 10)` (index.d.ts:14085).
  - **So yes — an explicit `exclude` argument should be passed** (at minimum `**/node_modules/**`; adding `**/.git/**` is defensive since a user-customized `files.exclude` may un-hide `.git`). Note `undefined` vs `null` differ: passing `null` disables even the dotfile defaults.
- **0-hit behavior**: resolves to an empty `Uri[]` — never rejects. If no workspace folders are open at all, it also returns no results (index.d.ts:14095-14096). So "no `info.toml` found" is a normal empty-array case the extension must handle (fall back to single-root behavior).
- **Large-tree cost**: it is a full recursive glob walk of every workspace folder not pruned by excludes. Ripgrep-backed and off-main-thread, so it won't freeze the UI, but on a huge monorepo without an explicit `node_modules` exclude it can take seconds and return noise. Mitigations available in-signature: `exclude` glob + `maxResults` cap + `token` cancellation. A `RelativePattern` scoped to a folder narrows the walk further.
- The extension already has a related pattern: `documentSelector` includes `{ scheme: 'file', pattern: '**/info.toml' }` (`packages/vscode-ext/src/extension.ts:102`) — glob matching on the same suffix, but that's per-document, not discovery.

### 2. Multi-folder workspaces

- `findFiles` **spans all `workspace.workspaceFolders` automatically** — "Find files across all workspace.workspaceFolders in the workspace" (index.d.ts:14082). Patterns are matched "relative to their workspace" and a `RelativePattern` restricts results to one folder (index.d.ts:14088-14089). One call suffices for multi-root; no per-folder loop needed unless per-folder scoping/excludes are wanted.
- `vscode.workspace.workspaceFolders` is `WorkspaceFolder[] | undefined`; extension.ts never reads it today (only `getConfiguration`, extension.ts:17). If needed for labeling or per-folder RelativePatterns, it is sync-available at activation.

### 3. Cursor / VSCodium parity

- Both are VS Code API-compatible: VSCodium is built from the same microsoft/vscode source (identical `vscode` module), and Cursor is a VS Code fork that keeps the stable extension API surface. `workspace.findFiles`, `workspace.workspaceFolders`, `RelativePattern`, and `createFileSystemWatcher` are long-stable (pre-1.30) core APIs — no known divergences for them in either editor. The extension already targets `engines.vscode ^1.82.0` (`package.json:10-12`), which Cursor/VSCodium satisfy.
- Caveat (stated without web re-verification): parity claims rest on both editors' extension-API compatibility guarantees; proposed/experimental APIs are where forks diverge, and none are used here. No action needed for t3; worth a smoke-test on Cursor during implementation QA only.

### 4. What the server `initialize` accepts today

- `~/src/lsp-openplanet/src/server/mod.rs:220-230`: `initialize()` reads **only `params.root_uri`** — `if let Some(root_uri) = params.root_uri` → `workspace_root` + `LspConfig::load(Some(&path), params.initialization_options.as_ref())` (mod.rs:224-228). `workspace_folders` is **never read anywhere in server src** (grep over `src/`: zero hits). Manifest lookup stays `root.join("info.toml")` (mod.rs:161).
- Transport does carry the data: tower-lsp 0.20's `InitializeParams` (lsp-types 0.94.1, `lib.rs:1064-1113`) has `workspace_folders: Option<Vec<WorkspaceFolder>>` (lib.rs:1101-1106, serde-skipped when absent) alongside `root_uri` (lib.rs:1081-1082) and `initialization_options: Option<Value>` (lib.rs:1084-1086).
- And the client **already sends it**: vscode-languageclient 9.0.1 builds `initParams` with `rootUri` from the *first* workspace folder only (`_clientGetRootPath`, `lib/common/client.js:922-928`; `lib/node/main.js:499-507`), then `fillInitializeParams` (client.js:813, 1331-1336) lets `WorkspaceFoldersFeature.fillInitializeParams` overwrite `params.workspaceFolders` with **all** folders (`lib/common/workspaceFolder.js:32-40`). The feature is registered unconditionally unless `clientOptions.workspaceFolder` locks the client (client.js:1304-1308) — and extension.ts:96-114 sets no such lock.
- Net: at `initialize` the server receives `workspaceFolders = [all folders]` on the wire today but ignores it; `root_uri` = folder[0]. In the `dips++-all` scenario root_uri is the parent dir and the server finds no `info.toml` there — the gap this map exists to close. No tower-lsp upgrade needed to consume `workspace_folders`; it's a server-code change only.

### 5. Carrying explicit plugin roots via `initializationOptions`

- Precedence contract (`packages/vscode-ext/src/settings.ts:4-11`): server layers `auto-detect < repo .openplanet-lsp.toml < user config < initializationOptions`; therefore **an unset VS Code setting must forward nothing**. `buildInitializationOptions` (settings.ts:48-69) implements this: only non-empty keys are emitted, snake_case names (`openplanet_dir`, `plugins_dir`, `game_target`, `defines`), `{}` when all unset. `startClient` forwards the result verbatim (extension.ts:91-94, 113).
- `contributes.configuration` (`packages/vscode-ext/package.json:63-106`) shows the pattern: string/array settings, `default: ""`/`[]`, `markdownDescription` documenting what is forwarded and the `.openplanet-lsp.toml` override interplay.
- **Minimal candidate shape** (policy deliberately undecided — options only):
  - `openplanetLsp.pluginRoots`: `type: "array", items: {type:"string"}, default: []` — absolute (or per-folder-relative) paths forwarded as `plugin_roots` **only when non-empty**, mirroring the `defines` key exactly (settings.ts:65-67). Empty array forwards nothing → auto-discovery and/or repo config keep control. Cost: one settings key, one `if` in `buildInitializationOptions`, one entry in `readSettings` (extension.ts:16-25).
  - Optional companion `openplanetLsp.pluginRootDiscovery`: `enum: ["auto","manual"], default: "auto"` gating whether the extension runs `findFiles` at all (manual = rely solely on `pluginRoots`). Two keys instead of one, but makes "I don't want a workspace scan" expressible without the sentinel-empty-array ambiguity.
  - Alternative shapes considered and noted, not recommended-for: encoding roots in the existing `pluginsDir` (semantics clash — that's the OpenPlanet game plugins dir, package.json:76-80); a per-workspace-state list (invisible, unversioned); `workspace/didChangeConfiguration` push (server has no config-change handler — extension.ts:178-180 — so initialize-time restart remains the only channel regardless).

### 6. Ordering constraints vs `client.start()` / restart flow

- Today `activate` fire-and-forgets `startClient` (extension.ts:169); `startClient` is async but everything before `await client.start()` (extension.ts:120) is synchronous settings reads. `initializationOptions` is a **snapshot baked into the initialize request** — vscode-languageclient serializes it once at `client.js:793, 799-812`. There is no post-start mutation path, and the server treats config as initialize-time-only (no `didChangeConfiguration`; extension.ts:178-180 comment). Therefore: **roots discovered via `findFiles` must be awaited before `buildInitializationOptions` runs**, i.e. at the top of `startClient` (before extension.ts:91). Anything else requires new server surface (custom request/notification after `initialized`), which does not exist today.
- `restartClient` (extension.ts:147-163) serializes stop→start with the `restarting` flag. Root discovery must happen **inside** `startClient` (not in the caller) so it inherits that serialization; discovering in `activate`/`onDidChangeConfiguration` before calling restart would race concurrent restarts and could pin stale roots.
- Config changes already trigger a debounced restart for any `openplanetLsp.*` change (extension.ts:180-189) — so a future `pluginRoots` setting change re-runs discovery + initialize with no extra wiring.
- Latency note: awaiting `findFiles` before `client.start()` delays server spawn by the scan duration (single-digit ms on plugin-sized trees with a `node_modules` exclude; potentially seconds on a huge tree without one — reinforcing the explicit-exclude/maxResults point in §1). `workspaceFolders` itself needs no await.
- Discovering roots *after* start and shipping them via a later message is a non-option today but worth naming for the map's "watched-file semantics / new info.toml after init" open item (map.md "Not yet specified"): the client watcher currently forwards only `**/*.as` (extension.ts:110), and the server ignores watched-file notifications anyway.

### Options summary (recommendation-neutral)

- **Discovery**: (a) single `findFiles('**/info.toml', '**/node_modules/**' (+ maybe `**/.git/**`), maxResults?)` spanning all folders — one call, needs explicit exclude; (b) explicit user list via `initializationOptions` (see §5); (c) both, list-wins-when-set (matches the existing precedence contract); (d) rely on LSP `workspaceFolders` alone — insufficient, since folders ≠ `info.toml` dirs.
- **Transport**: `params.workspace_folders` already arrives at the server (lsp-types 0.94.1 carries it; client already sends it) — currently ignored at mod.rs:222-230. An explicit `initializationOptions.plugin_roots` list is the other available channel; both fit "one server, N workspaces" without tower-lsp changes.
- **Ordering**: roots must be final before `client.start()` (initialize-time snapshot; no dynamic channel), discovered inside `startClient` to inherit restart serialization; empty discovery result must degrade gracefully to today's single-root behavior.
