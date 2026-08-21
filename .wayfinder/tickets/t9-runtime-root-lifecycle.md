# t9 — Runtime root lifecycle (new/removed info.toml, folder changes)

label: wayfinder:grilling · status: closed · resolved: 2026-08-21 (session w/ Hermes)

## Question

Roots are discovered at `initialize` (t2: downward walk / explicit override). What happens
when the set changes mid-session — a new `info.toml` dir appears, one is deleted, a
workspace folder is added/removed? Options: (a) frozen at init, restart to pick up changes
(today's reality: no watched-files/workspace-folders handlers at all — t1 §2/§8); (b)
server grows `didChangeWatchedFiles` handling for `**/info.toml` + client watcher glob
widening (extension.ts watcher forwards only `**/*.as` today) → re-walk + incremental
workspace add/remove; (c) `workspace/didChangeWorkspaceFolders` support (client feature
exists server-side capability-gated). Weigh: cost of new server surface vs how often users
actually add plugins mid-session (rare? git checkout of a new plugin dir). Decide the
phase-1 story (probably frozen-at-init + document it) vs later phase.

## Resolution

**Phase-1 includes dynamic root lifecycle via watched files.**

1. **Server**: grows a `didChangeWatchedFiles` handler (t1: none exists today) reacting to
   `**/info.toml` events:
   - **Created / Deleted** → re-run the t2 discovery walk (or re-derive from the explicit
     `plugin_roots` list — explicit override stays frozen) → diff against the live root set
     → **add/remove workspaces incrementally** (new root: load + first diagnostics publish;
     removed root: drop workspace, clear its published diagnostics incl. its info.toml).
   - **Changed** (info.toml content, root set unaffected) → rebuild the owning workspace
     (same path as a document change there: full rewalk of that root — manifests feed
     defines/deps).
2. **Client**: extension.ts `fileEvents` watcher gains `**/info.toml` alongside
   `**/*.as` (one watcher entry; the existing watcher already exists for forward-compat —
   the comment there predicted exactly this). Server declares watched-files capability.
3. Out of phase-1: `didChangeWorkspaceFolders` handling (VS Code multi-root folder
   add/remove mid-session) — noted as a follow-up; the watched-files path covers the
   common case (new plugin dir under an already-open folder).
4. Isolation maintained: an incremental add/remove touches only that workspace's snapshot
   and diagnostics; no cross-workspace invalidation (t0).
