# t4 — Stray `.as` files outside any plugin root

label: wayfinder:grilling · status: closed · resolved: 2026-08-21 (session w/ Hermes)

## Question

`.as` files NOT under any `info.toml` dir (opened folder has no plugins, or mixed trees like
`dips++-all/dd2-server` beside plugin dirs): which workspace serves them? Options: a
degenerate root-level workspace (today's behavior preserved as fallback), none (no LSP
features), or nearest-plugin-root. Also: `untitled:` scheme documents (client selector
already includes them). Pick semantics + what tests pin them.

## Resolution

**No workspace claims strays — reuse the existing per-request fallback parse.**

- Stray `.as` files (under no plugin root) get exactly today's out-of-snapshot behavior:
  per-request owned parse (`mod.rs:129-149`) — parse-level diagnostics and features from
  the file's own syntax, no workspace context, no cross-file resolution.
- Chosen because: preserves t0 isolation trivially (strays can't pollute any plugin
  workspace's symbol pool — t1 "symbol bleed" risk avoided), zero new machinery, and it's
  the behavior out-of-root docs already have today.
- Rejected: degenerate opened-folder workspace (phantom N+1th workspace, symbol-bleed risk
  into plugin pools); nearest-plugin-root (breaks isolation).
- `untitled:` docs: same fallback (per-request parse) — unchanged from today.
- Corollary: the t2 zero-found fallback (single-root on opened folder when NO plugin roots
  exist) remains the correct behavior for plugin-less trees — the two decisions compose:
  zero roots → opened-folder workspace serves everything; N≥1 roots → strays get nothing.
