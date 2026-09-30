import { after } from "next/server";
import { getServices } from "@/server/container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const { gateway } = getServices();
  const response = await gateway.listModels(request);
  after(() => gateway.settle());
  return response;
}

export async function OPTIONS(request: Request): Promise<Response> {
  return getServices().gateway.preflight(request);
}
