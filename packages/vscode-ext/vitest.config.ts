import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // See the root vitest.config.ts: `vscode` only exists inside a running
      // extension host, so it is aliased to a fake for unit tests.
      vscode: fileURLToPath(new URL('./tests/mocks/vscode.ts', import.meta.url)),
    },
  },
});
