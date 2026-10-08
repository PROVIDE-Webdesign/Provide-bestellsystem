import { env } from "cloudflare:workers";
import { handleCheckoutGateway } from "../../../../../storefront/protected-gateway";
import type { GatewayParams } from "../../../../../storefront/gateway";
export async function GET(
  request: Request,
  context: { params: Promise<GatewayParams> },
): Promise<Response> {
  return handleCheckoutGateway(request, await context.params, env);
}
export async function POST(
  request: Request,
  context: { params: Promise<GatewayParams> },
): Promise<Response> {
  return handleCheckoutGateway(request, await context.params, env);
}
