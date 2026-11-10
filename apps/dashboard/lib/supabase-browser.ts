import { createBrowserClient } from "@supabase/ssr";

import { dashboardPublicConfig } from "./config.js";
import { dashboardAuthCookieOptions } from "./auth-cookie-options.js";

export function createDashboardBrowserClient(detectSessionInUrl = true) {
  const config = dashboardPublicConfig();
  if (!config) return undefined;
  return createBrowserClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: dashboardAuthCookieOptions,
    auth: { flowType: "pkce", detectSessionInUrl },
  });
}
