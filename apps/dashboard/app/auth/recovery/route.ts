import { createDashboardServerClient } from "@/lib/supabase-server.js";
export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const destination = new URL("/recovery", incoming.origin);
  const p = incoming.searchParams;
  const code = p.get("code");
  let verified = false;
  if (
    process.env.ACCOUNT_RECOVERY_ENABLED === "true" &&
    process.env.DASHBOARD_AUTH_ENABLED === "true" &&
    process.env.ACCOUNT_RECOVERY_ORIGIN === incoming.origin &&
    p.size === 1 &&
    p.getAll("code").length === 1 &&
    code &&
    /^[A-Za-z0-9_-]{1,2048}$/.test(code)
  ) {
    try {
      const supabase = await createDashboardServerClient();
      if (supabase) verified = !(await supabase.auth.exchangeCodeForSession(code)).error;
    } catch {
      /* Generic error, never reflect provider/code details. */
    }
  }
  if (!verified) destination.hash = "link_failed";
  return new Response(null, {
    status: 303,
    headers: {
      location: destination.href,
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
