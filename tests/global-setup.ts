/**
 * globalSetup — prepare (and afterwards remove) the dedicated SQLite test
 * database. Vitest runs the named `setup` export before all tests and the
 * named `teardown` export after the whole run.
 *
 * setup   → creates db/test.db from the SAME prisma/schema.prisma via
 *           `prisma db push --skip-generate` (client generation is
 *           skipped: the dev server holds the generated client and the
 *           schema is untouched).
 * teardown → deletes db/test.db so the working tree stays clean
 *           (db/*.db is gitignored); a fresh copy is created every run,
 *           keeping runs deterministic.
 */
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { PROJECT_ROOT, TEST_DATABASE_URL, TEST_DB_FILE } from './setup-env'

export async function setup(): Promise<void> {
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL }
  try {
    execSync('bunx prisma db push --skip-generate', {
      cwd: PROJECT_ROOT,
      env,
      stdio: 'pipe',
      timeout: 120_000,
    })
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string }
    // Surface the CLI output — prisma failures are otherwise opaque here.
    console.error(
      '[global-setup] prisma db push failed:',
      e.message,
      String(e.stdout ?? ''),
      String(e.stderr ?? '')
    )
    throw err
  }
}

export async function teardown(): Promise<void> {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(`${TEST_DB_FILE}${suffix}`, { force: true })
  }
}
