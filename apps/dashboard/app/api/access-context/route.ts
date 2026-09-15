import { fetchDashboardAccess } from "@/lib/gateway.js";
import { createDashboardServerClient } from "@/lib/supabase-server.js";

const secureHeaders = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function failure(status: 401 | 503) {
  return Response.json(
    { error: { code: status === 401 ? "unauthorized" : "service_unavailable" } },
    { headers: secureHeaders, status },
  );
}

export async function GET() {
  if (process.env.DASHBOARD_AUTH_ENABLED !== "true") return failure(503);
  const supabase = await createDashboardServerClient();
  if (!supabase) return failure(503);
  const claims = await supabase.auth.getClaims();
  if (claims.error) return failure(claims.error.status === 401 ? 401 : 503);
  if (!claims.data?.claims?.sub) return failure(401);
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) return failure(401);
  return fetchDashboardAccess(accessToken, process.env.DASHBOARD_API_BASE_URL);
}
