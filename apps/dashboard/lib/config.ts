export interface DashboardPublicConfig {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
}

export function parseDashboardPublicConfig(
  supabaseUrl: string | undefined,
  publishableKey: string | undefined,
): DashboardPublicConfig | undefined {
  if (!supabaseUrl || !publishableKey || publishableKey.length < 20 || publishableKey.length > 4096)
    return undefined;
  try {
    const url = new URL(supabaseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    )
      return undefined;
    return { supabaseUrl: url.href.replace(/\/$/, ""), publishableKey };
  } catch {
    return undefined;
  }
}

export function dashboardPublicConfig(): DashboardPublicConfig | undefined {
  return parseDashboardPublicConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
