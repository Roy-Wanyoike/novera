/**
 * Per-worker env bootstrap — runs BEFORE any test module (and therefore
 * before src/lib/db.ts and its PrismaClient engine) is imported.
 *
 * The dedicated test database lives at <project root>/db/test.db.
 * We use an ABSOLUTE file: URL on purpose: the Prisma CLI resolves
 * relative SQLite paths against the schema directory (prisma/), while the
 * runtime engine resolves them against the process CWD — a literal
 * "file:./db/test.db" would therefore open two different files. An
 * absolute URL points both at the same db/test.db.
 */
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const TEST_DB_FILE = fileURLToPath(new URL('../db/test.db', import.meta.url))
/** e.g. file:/home/z/my-project/db/test.db */
export const TEST_DATABASE_URL = `file:${TEST_DB_FILE}`

process.env.DATABASE_URL = TEST_DATABASE_URL
