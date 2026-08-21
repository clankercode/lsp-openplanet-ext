# t2 — Root discovery mechanism: client-scan-and-send vs server-side scan

label: wayfinder:grilling · status: closed · resolved: 2026-08-21 (session w/ Hermes)

## Question

How do the plugin roots get into the server? (a) Client scans (`findFiles('**/info.toml')`)
and sends them — editor-uniform excludes, works for remote/multi-folder, but every client
must implement it; (b) server walks `rootUri` itself — uniform for all editors, but needs
its own exclude/depth policy; (c) hybrid: server walks by default, client may override via
`initializationOptions`. Decide with t1/t3 facts in hand (defaults: depth ≤2 from opened
root? `info.toml` AT the root = today's single-plugin case, unchanged).

## Resolution

**Hybrid: server-side downward walk by default; explicit `plugin_roots` init-option
overrides the walk when set.**

Three sub-decisions:

1. **Mechanism**: server reads `params.workspace_folders` (already on the wire from
   vscode-languageclient AND Neovim/helix; ignored today — t3 §4) and walks each folder
   downward for `info.toml` dirs. A non-empty `plugin_roots` initializationOption replaces
   the walk entirely (manual override for weird trees; matches the settings precedence
   contract — unset forwards nothing). Implication: the extension needs NO `findFiles`
   auto-scan — only the optional `openplanetLsp.pluginRoots` manual setting.
2. **Walk policy**: first-match stop — a dir containing `info.toml` is a root and the walk
   does NOT descend into it (also resolves nested roots: outer wins, inner unreachable).
   Skip-list: hidden dirs, `.git`, `node_modules`. Hard depth cap 5 (pathological trees).
3. **Zero-found fallback**: single-root fallback on the opened folder itself — exactly
   today's no-manifest behavior (manifest-less workspace from `.as` files). Zero regression
   for existing single-folder users. Mixed trees (`.as` under no plugin root, e.g.
   `dips++-all/dd2-server`) stay t4's problem.
