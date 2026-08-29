import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Root vitest config that discovers tests in both workspace packages and
// the repo-level scripts/ directory. Scripts are NOT a workspace package so
// `pnpm -r test` cannot reach them; a root-level vitest run catches both.
//
// Individual packages retain their own `vitest.config.ts` for the
// `pnpm -F <pkg> test` flow.
export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'scripts/tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      // `vscode` only exists inside a running extension host, so importing
      // src/extension.ts would otherwise be impossible outside an integration
      // harness. Alias it to a fake implementing exactly the surface the
      // extension touches. No other package imports `vscode`, so this is
      // inert for the rest of the workspace.
      vscode: fileURLToPath(
        new URL('./packages/vscode-ext/tests/mocks/vscode.ts', import.meta.url),
      ),
    },
  },
});
