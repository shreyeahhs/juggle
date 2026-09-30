import { sql } from "drizzle-orm";
import { createPgliteHandle, type DbHandle } from "@/server/db/client";

/**
 * Fresh in-memory Postgres (PGlite) with all migrations applied.
 * Booting one takes seconds, so create it once per test file (`beforeAll`)
 * and call `resetDb` between tests.
 */
export async function createTestDb(): Promise<DbHandle> {
  const handle = createPgliteHandle();
  await handle.migrate();
  return handle;
}

const TABLES = ["provider_keys", "provider_key_cooldowns", "requests", "rate_limit_events", "rate_limit_counters"];

/** Empties every table; far faster than booting a new database. */
export async function resetDb(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));
}

/** Obviously fake values; never a real credential. */
export const TEST_AUTH_SECRET = "test-secret-test-secret-test-secret-0123456789";
export const TEST_OWNER_PASSWORD = "test-owner-password";
