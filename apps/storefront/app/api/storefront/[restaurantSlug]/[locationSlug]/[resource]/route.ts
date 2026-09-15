import { env } from "cloudflare:workers";
import { fetchPublicStorefront, type GatewayParams } from "../../../../../storefront/gateway";

export async function GET(
  request: Request,
  context: { params: Promise<GatewayParams> },
): Promise<Response> {
  const binding = (env as { PUBLIC_API_URL?: unknown }).PUBLIC_API_URL;
  return fetchPublicStorefront(
    request,
    await context.params,
    typeof binding === "string" ? binding : undefined,
  );
}
