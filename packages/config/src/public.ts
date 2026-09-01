import type { AppEnvironment } from "@provide/contracts";

import { type EnvironmentSource, requireAppEnvironment, requireUrl } from "./internal.js";

export interface PublicEnvironment {
  readonly APP_ENV: AppEnvironment;
  readonly PUBLIC_API_URL: string;
  readonly PUBLIC_DASHBOARD_URL: string;
  readonly PUBLIC_STOREFRONT_URL: string;
}

export function loadPublicEnvironment(source: EnvironmentSource): PublicEnvironment {
  return {
    APP_ENV: requireAppEnvironment(source),
    PUBLIC_API_URL: requireUrl(source, "PUBLIC_API_URL", ["http:", "https:"]),
    PUBLIC_DASHBOARD_URL: requireUrl(source, "PUBLIC_DASHBOARD_URL", ["http:", "https:"]),
    PUBLIC_STOREFRONT_URL: requireUrl(source, "PUBLIC_STOREFRONT_URL", ["http:", "https:"]),
  };
}
