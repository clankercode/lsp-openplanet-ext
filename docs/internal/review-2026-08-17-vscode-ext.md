# Reviewer A — VS Code extension review (2026-08-17)

Scope: `packages/vscode-ext/**` + `packages/binary-resolver/src/**`. Verified against server source at `/home/xertrov/src/lsp-openplanet` (v0.5.0 per BINARY_REF).

## P0 — correctness bugs

1. **Dead PATH fallback in `src/extension.ts:19-24`.** `context.asAbsolutePath()` returns an absolute path string unconditionally (it never checks existence, never returns falsy), so `|| 'openplanet-lsp'` is unreachable dead code. Consequence today: with no `bin/` in the VSIX (binaries not yet wired into packaging), the command is a *nonexistent absolute path* and the server spawn fails with ENOENT even when the user has `openplanet-lsp` on PATH. Fix: use `existsSync` checks (or wire in `binary-resolver`, which exists for exactly this) instead of `||`-chaining `asAbsolutePath`.

2. **`void client.start()` with no `.catch`** (extension.ts:44). Given (1), spawn failure produces an unhandled rejection; the user sees nothing unless they open the output channel. Catch and surface a friendly message (with the `BinaryNotFoundError.checkedLocations` list once the resolver is wired in) + "Open Settings" action for `openplanetLsp.serverPath`.

3. **No `vscode:prepublish` script in `package.json`.** `vsce package` runs it before packing; it's absent, so `pnpm package` on a clean checkout packs a stale or *missing* `dist/extension.js` (the `main` entry). The justfile's `build-vsce` hides this by running build first, but the npm script (and any CI calling it directly) is a footgun. Add `"vscode:prepublish": "node esbuild.mjs"`.

4. **Bundling pitfall for the planned binary-resolver integration (empirically verified).** `binary-resolver` is ESM (`"type": "module"`) and its default resolver uses `createRequire(import.meta.url)`. esbuild-bundling that into the CJS `dist/extension.js` yields `import.meta.url === undefined` at runtime → `createRequire` throws `ERR_INVALID_NODE_JS_TYPE`-style failure (reproduced with the repo's own esbuild 0.21: `TypeError [ERR_INVALID_ARG_VALUE] ... Received undefined`). When wiring the resolver in, either define a shim (e.g. `define: { 'import.meta.url': 'require("url").pathToFileURL(__filename).href' }`) or inject `__filename`-based `createRequire`. Worth a comment in esbuild.mjs now so M4/M6 doesn't trip on it.

## P1 — goal-context gaps ("launch reliably, surface diagnostics, expose config surface")

5. **No config surface exposed.** Server `initialize` accepts `initializationOptions` (`openplanet_dir`, `plugins_dir`, `game_target`, `defines` — src/config.rs `apply_init_options`), highest-priority config layer. The extension exposes only `openplanetLsp.serverPath` and passes no `initializationOptions`. Should contribute settings and forward them, e.g.:
   - `openplanetLsp.gameTarget` — enum `TMNEXT | MP4 | TURBO | MP3 | UNITED_FOREVER | NATIONS_FOREVER` (matches `defines_for_target` arms), default `TMNEXT`; description should note it flips preprocessor defines / dead `#if` branches (GH #36).
   - `openplanetLsp.openplanetDir`, `openplanetLsp.pluginsDir` (string paths).
   - Optionally `openplanetLsp.defines` (array).
   Note: server has **no** `didChangeConfiguration` / `workspace/configuration` handler (verified in server/mod.rs), so any setting change requires a client restart — see (6).

6. **No restart story.** `serverPath` (and future settings) changes silently do nothing until window reload. Standard pattern: `context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('openplanetLsp')) void client?.stop().then(() => client?.start()); }))` (or offer a command). Since the server is config-static, auto-restart is the only way settings take effect.

7. **Spawn arguments: pass `--lsp` explicitly.** Verified the server's bare-launch routing: no args + non-TTY stdin → LSP (`entrypoint::decide_bare_launch`), so VS Code's piped stdio works today. But `--lsp`/`lsp` is the documented force-LSP flag and costs nothing — insurance if launch routing or `default_mode` semantics ever change. Add `args: ['--lsp']` to ServerOptions (serverOptions currently supports `args` and it's absent).

8. **`synchronize.fileEvents` watcher is currently useless.** Server does not implement `did_change_watched_files` (verified — only `did_open`/`did_change`/`did_close`). Notifications are sent and ignored. Either drop it or keep with a comment that it's forward-looking; also the watcher isn't pushed to `context.subscriptions` (client manages its disposables, so it's fine, but a comment helps).

## P2 — packaging / marketplace quality

9. **No README.md, icon, or CHANGELOG in `packages/vscode-ext/`.** `vsce package` warns on missing README; marketplace/OVSX listing renders with no docs. README should cover: install, zero-setup binary expectations, `game_target` setting, `.openplanet-lsp.toml` precedence (init options beat config file — document that VS Code settings override the repo config file), and PATH fallback escape hatch. Add a 128×128 `icon.png` (contributes `icon` field) — OVSX shows a placeholder otherwise.

10. **Untrusted workspaces undeclared.** The extension spawns a user-configurable binary (`serverPath`) and analyzes untrusted file contents. Declare `"capabilities": { "untrustedWorkspaces": { "supported": "limited", "description": "..." } }` and consider disabling `serverPath` override in untrusted contexts.

11. **`.vscodeignore` is thin but mostly right** (bin/ not excluded — good for the future platform-binary VSIXs). Add `**/*.tsbuildinfo`, `.DS_Store`, `tests/**` for hygiene. Keep `language-configuration.json` and `syntaxes/` shipped (they're referenced by contributes).

12. **Version skew:** extension is 0.2.0 while BINARY_REF pins v0.5.0. If the VSIX bundles binaries, its version should track BINARY_REF (the repo just fixed the 4-month-stale ref; the extension version has the same staleness problem).

13. **esbuild:** `sourcemap: false` — consider `--sourcemap` (external .map; ~cheap, big debugging win, excluded from VSIX via `.vscodeignore` addition). `target: 'node18'` vs engines node ≥20 is fine (VS Code's runtime is ≥18).

## P3 — language configuration nits

14. **`"brackets"` includes `["<", ">"]`** (language-configuration.json:10). AngelScript does have `array<int>` template types, but `<`/`>` are overwhelmingly comparison operators; including them in `brackets` poisons bracket-match colorization and indent-based folding on every `a < b && c > d`. Drop the pair (most C-family configs do).

15. **Missing single-quote pairs.** AngelScript string literals may be single-quoted; add `{ "open": "'", "close": "'" }` to `autoClosingPairs` and `["'", "'"]` to `surroundingPairs` (with `notIn: ["string", "comment"]` guards if desired).

16. `wordPattern` is default; AngelScript handles (`@`) and metadata (`#`) chars make double-click selection wrong for `Class@`, `#include`. Low priority; a custom `wordPattern` fixes selection/completion word-range.

## binary-resolver (supporting package) notes

17. **Good shape overall** — layered override → vscode-bundle → npm-platform-pkg → gated PATH fallback, structured `BinaryNotFoundError` with checked locations, solid test coverage per module, unscoped npm package names match the published `openplanet-lsp-{platform}-{arch}` packages (verified against npm/ manifests at v0.5.0).

18. **`ResolveResult.version` is declared but never populated** (types.ts:23; `resolveBinary` never calls `checkBinaryVersion`). Either populate it in `resolveBinary` (nice for logging/telemetry) or drop the field — as-is it's dead API surface inviting misuse.

19. **Override/PATH existence checks on Windows:** `existsSync(override)` won't find `openplanet-lsp` when only `openplanet-lsp.exe` exists (PATH fallback is fine — `getBinaryName()` appends `.exe` on win32; override is not). Consider probing the platform-suffixed name too when `override` misses. Also relative `override` resolves against VS Code's arbitrary cwd — document that it should be absolute (or resolve `~`).

20. **PATH fallback is env-gated (`OPENPLANET_LSP_ALLOW_PATH=1`) with no extension-facing switch.** For VS Code users who installed `openplanet-lsp` via npm globally, resolver failure + gated PATH means "no binary" even though one exists. When wiring the resolver into the extension, consider an `openplanetLsp.allowPathFallback` (or reuse `serverPath` set to bare name) escape hatch so the gate is user-controllable rather than env-only.

21. `_platformPackageResolver` test hatch is reachable through the public `ResolveOptions` cast (`InternalResolveOptions` is `ResolveOptions & {...}` with no brand) — harmless but it's public-ish API by accident; a `@internal` JSDoc on the interface or symbol-branding would keep it honest.

## Cross-cutting (out of scope but blocks the goal)

- `publish-vsce.yml` / `publish-ovsx.yml` are PAT-gated stubs ("full publish pipeline lands in M4/M6") — no CI step yet builds per-platform VSIXs or fetches platform binaries into `vscode-ext/bin/` before `vsce package`. The zero-setup marketplace goal depends on that landing together with the resolver wiring above.
