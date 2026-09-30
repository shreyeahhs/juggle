import { after } from "next/server";
import { getServices } from "@/server/container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Model ids may contain slashes (`gemini/gemini-3.8-flash`, `models/gemini-3.8-flash`). */
export async function GET(request: Request, context: RouteContext<"/v1/models/[...model]">): Promise<Response> {
  const { gateway } = getServices();
  const { model } = await context.params;
  const response = await gateway.retrieveModel(request, model.join("/"));
  after(() => gateway.settle());
  return response;
}

export async function OPTIONS(request: Request): Promise<Response> {
  return getServices().gateway.preflight(request);
}
