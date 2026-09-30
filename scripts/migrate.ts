/**
 * Applies pending SQL migrations from ./drizzle.
 *   pnpm db:migrate
 * Uses DATABASE_URL when set, otherwise the embedded development database.
 */
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

const { createDbHandleFromEnv } = await import("@/server/db/client");

const handle = createDbHandleFromEnv();
const started = Date.now();
try {
  await handle.migrate();
  console.log(`✓ Migrations applied (${handle.driver}) in ${Date.now() - started} ms`);
} catch (error) {
  console.error("✗ Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
