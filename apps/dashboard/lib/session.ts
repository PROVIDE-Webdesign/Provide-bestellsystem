import { createDashboardServerClient } from "./supabase-server.js";

export type DashboardSessionResult =
  | { readonly status: "authenticated"; readonly accessToken: string }
  | { readonly status: "unauthorized" | "unavailable" };

export async function dashboardAccessToken(): Promise<DashboardSessionResult> {
  const supabase = await createDashboardServerClient();
  if (!supabase) return { status: "unavailable" };
  const claims = await supabase.auth.getClaims();
  if (claims.error) return { status: claims.error.status === 401 ? "unauthorized" : "unavailable" };
  if (!claims.data?.claims?.sub) return { status: "unauthorized" };
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  return accessToken ? { status: "authenticated", accessToken } : { status: "unauthorized" };
}
