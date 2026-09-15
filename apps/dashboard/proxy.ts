import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { dashboardPublicConfig } from "./lib/config.js";

export async function proxy(request: NextRequest) {
  const config = dashboardPublicConfig();
  if (!config) return NextResponse.next({ request });
  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.supabaseUrl, config.publishableKey, {
    auth: { flowType: "pkce" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        for (const value of values) request.cookies.set(value.name, value.value);
        response = NextResponse.next({ request });
        for (const value of values) response.cookies.set(value.name, value.value, value.options);
      },
    },
  });
  await supabase.auth.getClaims();
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
