# t8 — workspace/symbol semantics across N isolated workspaces

label: wayfinder:grilling · status: open · blocked-by: (none)

## Question

`workspace/symbol` today spans the ONE snapshot (`mod.rs:465-476`). With N isolated plugin
workspaces: union of all workspaces' symbols (one flat result set — simplest, symbols are
namespaced by file path anyway) vs scope-to-current-workspace (matches isolation but the
query has no "current" workspace — needs an active-editor heuristic) vs always-union with a
per-workspace grouping label. Also decide: does per-workspace isolation leak symbol *names*
via workspace/symbol (acceptable? — it's a search feature, not resolution)? Pin the choice
+ one test (e.g. symbol query "CheckInit" returns hits from both plugin roots).
