import { sql } from "drizzle-orm";
import { getDbHandle } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + readiness for container orchestration. Deliberately unauthenticated and contentless. */
export async function GET(): Promise<Response> {
  try {
    await getDbHandle().db.execute(sql`select 1`);
    return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ status: "degraded", database: "unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
