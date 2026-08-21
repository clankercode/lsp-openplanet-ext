# t8 — workspace/symbol semantics across N isolated workspaces

label: wayfinder:grilling · status: closed · resolved: 2026-08-21 (session w/ Hermes)

## Question

`workspace/symbol` today spans the ONE snapshot (`mod.rs:465-476`). With N isolated plugin
workspaces: union of all workspaces' symbols (one flat result set — simplest, symbols are
namespaced by file path anyway) vs scope-to-current-workspace (matches isolation but the
query has no "current" workspace — needs an active-editor heuristic) vs always-union with a
per-workspace grouping label. Also decide: does per-workspace isolation leak symbol _names_
via workspace/symbol (acceptable? — it's a search feature, not resolution)? Pin the choice

- one test (e.g. symbol query "CheckInit" returns hits from both plugin roots).

## Resolution

**Union — query all N workspaces, one flat result set.**

- Every workspace's symbol pool is searched; results merged; file paths in locations
  disambiguate same-name symbols across plugins.
- Symbol-name visibility across workspaces via a search index is accepted: workspace/symbol
  is navigation/search, not resolution — it can't create a type relation, so t0 isolation
  (no cross-root resolution) is unaffected. Navigating to a sibling's symbol works (it's
  navigation, not resolution).
- Rejected: active-editor scoping (heuristic on the server side, brittle — server doesn't
  track focus); grouping labels (client UI already groups by file path).
