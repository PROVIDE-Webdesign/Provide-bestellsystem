import { isAppEnvironment } from "@provide/contracts";

import { corsHeaders, parseAllowedOrigins } from "./cors.js";
import { createRequestContext } from "./context.js";
import { handleStorefront, type StorefrontReader } from "./storefront.js";
import { postgresStorefrontReader } from "./storefront-database.js";
import { probeDatabase } from "./database.js";
import { jsonError, jsonSuccess } from "./http.js";
import { consoleLogger, type ApiLogger } from "./logger.js";
import { isKnownPath, routeRequest } from "./router.js";

interface HyperdriveBinding {
  readonly connectionString: string;
}

interface Env {
  readonly APP_ENV: string;
  readonly API_ALLOWED_ORIGINS?: string;
  readonly HYPERDRIVE_CACHE_DISABLED?: string;
  readonly HYPERDRIVE?: HyperdriveBinding;
}

type DatabaseProbe = (connectionString: string) => Promise<void>;

export function createApiWorker(
  databaseProbe: DatabaseProbe = probeDatabase,
  logger: ApiLogger = consoleLogger,
  storefrontReader: StorefrontReader = postgresStorefrontReader,
) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const context = createRequestContext();
      const cors = corsHeaders(request, parseAllowedOrigins(env.API_ALLOWED_ORIGINS));
      const environment = isAppEnvironment(env.APP_ENV) ? env.APP_ENV : "unknown";

      if (request.method === "OPTIONS") {
        return new Response(null, { headers: cors, status: 204 });
      }

      const route = routeRequest(request);
      if (!route) {
        if (isKnownPath(request)) {
          return jsonError(
            "method_not_allowed",
            "Method is not allowed for this resource.",
            context.requestId,
            405,
            cors,
          );
        }
        return jsonError("not_found", "Resource was not found.", context.requestId, 404, cors);
      }

      if (route.name === "catalog" || route.name === "availability") {
        return handleStorefront(request, route, env, storefrontReader, context, logger, cors);
      }

      if (route.name === "health") {
        return jsonSuccess(
          {
            application: "api",
            database: env.HYPERDRIVE ? "configured" : "not-configured",
            environment,
            runtime: "cloudflare-workers",
            status: "ok",
          },
          context.requestId,
          200,
          cors,
        );
      }

      if (!env.HYPERDRIVE) {
        return jsonError(
          "service_unavailable",
          "Database health probe is not available.",
          context.requestId,
          503,
          cors,
        );
      }

      try {
        await databaseProbe(env.HYPERDRIVE.connectionString);
        return jsonSuccess({ database: "reachable", status: "ok" }, context.requestId, 200, cors);
      } catch {
        logger.error(context, "database_health_probe_failed");
        return jsonError(
          "service_unavailable",
          "Database health probe is not available.",
          context.requestId,
          503,
          cors,
        );
      }
    },
  };
}

export default createApiWorker() satisfies ExportedHandler<Env>;
