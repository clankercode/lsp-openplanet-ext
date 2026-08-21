# t2 — Root discovery mechanism: client-scan-and-send vs server-side scan

label: wayfinder:grilling · status: open · blocked-by: (none; t1+t3 research closed — ready to grill)

## Question

How do the plugin roots get into the server? (a) Client scans (`findFiles('**/info.toml')`)
and sends them — editor-uniform excludes, works for remote/multi-folder, but every client
must implement it; (b) server walks `rootUri` itself — uniform for all editors, but needs
its own exclude/depth policy; (c) hybrid: server walks by default, client may override via
`initializationOptions`. Decide with t1/t3 facts in hand (defaults: depth ≤2 from opened
root? `info.toml` AT the root = today's single-plugin case, unchanged).
