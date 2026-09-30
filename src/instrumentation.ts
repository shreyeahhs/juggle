/**
 * Runs once when the server starts (Next.js instrumentation hook).
 *
 * With RUN_MIGRATIONS=true the app applies pending migrations at boot, which
 * makes `docker compose up` work with no extra step. Run it on ONE instance, or
 * as a separate release step, so several instances don't migrate concurrently.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.RUN_MIGRATIONS !== "true") return;

  const [{ getDbHandle }, { logger }] = await Promise.all([import("@/server/db/client"), import("@/server/logger")]);
  const started = Date.now();
  try {
    await getDbHandle().migrate();
    logger.info("migrations applied at startup", { durationMs: Date.now() - started });
  } catch (error) {
    logger.error("startup migration failed", { error });
    throw error;
  }
}
