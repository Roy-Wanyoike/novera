import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * NOVERA kernel invariant test suite (Task 2-a).
 *
 * Path aliases mirror tsconfig.json:
 *   "@"            maps to ./src
 *   "@novera/..."  maps to ./packages/<name>/src
 *
 * Pool: forks with fileParallelism disabled — every test file runs
 * sequentially in ONE forked worker process. The PrismaClient singleton in
 * src/lib/db.ts resolves DATABASE_URL at engine start, so
 * tests/setup-env.ts (setupFiles — runs in the worker before any test
 * module is imported) sets it in time. A single writer also keeps the
 * SQLite test database lock-free.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@novera/money': fileURLToPath(new URL('./packages/money/src', import.meta.url)),
      '@novera/domain': fileURLToPath(new URL('./packages/domain/src', import.meta.url)),
      '@novera/policy': fileURLToPath(new URL('./packages/policy/src', import.meta.url)),
      '@novera/events': fileURLToPath(new URL('./packages/events/src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    pool: 'forks',
    fileParallelism: false,
    globalSetup: [fileURLToPath(new URL('./tests/global-setup.ts', import.meta.url))],
    setupFiles: [fileURLToPath(new URL('./tests/setup-env.ts', import.meta.url))],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
})
