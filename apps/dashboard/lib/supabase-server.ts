import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { dashboardPublicConfig } from "./config.js";

export async function createDashboardServerClient() {
  const config = dashboardPublicConfig();
  if (!config) return undefined;
  const cookieStore = await cookies();
  return createServerClient(config.supabaseUrl, config.publishableKey, {
    auth: { flowType: "pkce" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try {
          for (const value of values) cookieStore.set(value.name, value.value, value.options);
        } catch {
          // Server Components cannot write; proxy.ts performs the refresh write.
        }
      },
    },
  });
}
