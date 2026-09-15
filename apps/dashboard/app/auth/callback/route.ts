import { NextResponse, type NextRequest } from "next/server";

import { createDashboardServerClient } from "@/lib/supabase-server.js";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const destination = new URL("/", request.nextUrl.origin);
  if (process.env.DASHBOARD_AUTH_ENABLED === "true" && code && code.length <= 2048) {
    const supabase = await createDashboardServerClient();
    if (supabase) {
      const result = await supabase.auth.exchangeCodeForSession(code);
      if (!result.error) return NextResponse.redirect(destination);
    }
  }
  destination.pathname = "/login";
  destination.searchParams.set("error", "authentication_failed");
  return NextResponse.redirect(destination);
}
