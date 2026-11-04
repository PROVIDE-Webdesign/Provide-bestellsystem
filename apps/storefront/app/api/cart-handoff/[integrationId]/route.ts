import { env } from "cloudflare:workers";
import { handleHandoffGateway } from "../../../storefront/handoff-gateway";
async function handle(request: Request, context: { params: Promise<{ integrationId: string }> }) {
  return handleHandoffGateway(request, (await context.params).integrationId, env);
}
export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
