import { after } from "next/server";
import { getServices } from "@/server/container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Generation can be slow; allow up to five minutes on platforms that cap duration. */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const { gateway } = getServices();
  const response = await gateway.chatCompletions(request);
  // Keep the function alive until the metadata log has been written.
  after(() => gateway.settle());
  return response;
}

export async function OPTIONS(request: Request): Promise<Response> {
  return getServices().gateway.preflight(request);
}

export async function GET(request: Request): Promise<Response> {
  return getServices().gateway.notFound(request);
}
