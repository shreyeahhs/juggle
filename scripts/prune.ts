/**
 * Deletes usage metadata and expired counters older than the retention window.
 * Run it from cron, or a scheduled job on your host:
 *   pnpm db:prune
 */
import { lt } from "drizzle-orm";
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

const { createDbHandleFromEnv } = await import("@/server/db/client");
const { providerKeyCooldowns, rateLimitCounters, rateLimitEvents, requests } = await import("@/server/db/schema");
const { getEnv } = await import("@/server/env");

const handle = createDbHandleFromEnv();
const retentionDays = getEnv().REQUEST_LOG_RETENTION_DAYS;
const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
const now = new Date();

try {
  const deletedRequests = await handle.db.delete(requests).where(lt(requests.createdAt, cutoff)).returning({ id: requests.id });
  const deletedEvents = await handle.db.delete(rateLimitEvents).where(lt(rateLimitEvents.createdAt, cutoff)).returning({ id: rateLimitEvents.id });
  await handle.db.delete(rateLimitCounters).where(lt(rateLimitCounters.windowStart, new Date(now.getTime() - 2 * 86_400_000)));
  await handle.db.delete(providerKeyCooldowns).where(lt(providerKeyCooldowns.cooldownUntil, new Date(now.getTime() - 86_400_000)));

  console.log(`✓ Pruned ${deletedRequests.length} requests and ${deletedEvents.length} rate-limit events older than ${retentionDays} days`);
} catch (error) {
  console.error("✗ Prune failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
