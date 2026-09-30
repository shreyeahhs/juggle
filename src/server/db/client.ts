import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Driver-agnostic database handle (postgres-js in production, PGlite for tests and zero-setup dev). */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export interface DbHandle {
  db: Database;
  driver: "postgres" | "pglite";
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");
export const DEV_PGLITE_DIR = path.join(process.cwd(), ".data", "pglite");

export function createPostgresHandle(url: string, poolMax = 10): DbHandle {
  const client = postgres(url, {
    max: poolMax,
    idle_timeout: 20,
    connect_timeout: 10,
    // Keep query parameters (which can include ciphertext) out of driver notices.
    onnotice: () => {},
  });
  const db = drizzlePostgres({ client, schema });
  return {
    db: db as unknown as Database,
    driver: "postgres",
    migrate: () => migratePostgres(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => client.end({ timeout: 5 }),
  };
}

/**
 * Claims the embedded database directory for this process.
 *
 * PGlite supports exactly one process per data directory. Two processes (a dev
 * server and a CLI script, say) will not error: they diverge silently and lose
 * writes. This advisory lock turns that into an immediate, explanatory failure.
 */
function lockDataDir(dataDir: string): () => void {
  const lockPath = path.join(dataDir, "juggle.lock");
  try {
    writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const holder = (() => {
      try {
        return Number(readFileSync(lockPath, "utf8").trim());
      } catch {
        return Number.NaN;
      }
    })();
    // Reclaim the lock if the previous owner is gone (for example after a crash).
    let alive = false;
    try {
      process.kill(holder, 0);
      alive = holder !== process.pid;
    } catch {
      alive = false;
    }
    if (alive) {
      throw new Error(
        `The embedded development database at ${dataDir} is already in use by process ${holder}.\n` +
          `PGlite allows one process at a time, so stop the dev server before running database scripts ` +
          `(or set DATABASE_URL to a real PostgreSQL server to use both at once).`,
      );
    }
    writeFileSync(lockPath, String(process.pid));
  }
  return () => {
    try {
      if (readFileSync(lockPath, "utf8").trim() === String(process.pid)) rmSync(lockPath, { force: true });
    } catch {
      // Losing the lock file on shutdown is harmless.
    }
  };
}

/** `dataDir` undefined → in-memory database (tests, no lock needed). */
export function createPgliteHandle(dataDir?: string): DbHandle {
  let release = () => {};
  if (dataDir) {
    // PGlite only creates the leaf directory, so ensure the parents exist first.
    mkdirSync(dataDir, { recursive: true });
    release = lockDataDir(dataDir);
    process.once("exit", release);
  }
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzlePglite({ client, schema });
  return {
    db: db as unknown as Database,
    driver: "pglite",
    migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: async () => {
      await client.close();
      release();
    },
  };
}

export function createDbHandleFromEnv(): DbHandle {
  const env = getEnv();
  if (env.DATABASE_URL) return createPostgresHandle(env.DATABASE_URL, env.DATABASE_POOL_MAX);
  // getEnv() already refuses to run in production without DATABASE_URL.
  return createPgliteHandle(DEV_PGLITE_DIR);
}

// One handle per process; survives dev-server hot reloads.
const globalForDb = globalThis as unknown as { __juggleDb?: DbHandle };

export function getDbHandle(): DbHandle {
  globalForDb.__juggleDb ??= createDbHandleFromEnv();
  return globalForDb.__juggleDb;
}

export function getDb(): Database {
  return getDbHandle().db;
}
