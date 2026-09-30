import { getServices } from "@/server/container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Anything under /v1 that isn't implemented gets a JSON 404 in the same error shape. */
function handler(request: Request): Response {
  return getServices().gateway.notFound(request);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;

export function OPTIONS(request: Request): Response {
  return getServices().gateway.preflight(request);
}
