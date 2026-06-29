import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Tests share one Postgres; run sequentially to avoid wallet/idempotency races.
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 15_000,
    setupFiles: ['src/__tests__/setup.ts'],
  },
});
