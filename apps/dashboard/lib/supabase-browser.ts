import { createBrowserClient } from "@supabase/ssr";

import { dashboardPublicConfig } from "./config.js";

export function createDashboardBrowserClient() {
  const config = dashboardPublicConfig();
  if (!config) return undefined;
  return createBrowserClient(config.supabaseUrl, config.publishableKey, {
    auth: { flowType: "pkce" },
  });
}
