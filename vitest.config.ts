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
});
