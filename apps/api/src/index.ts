import { isAppEnvironment } from "@provide/contracts";

import { probeDatabase } from "./database.js";

interface HyperdriveBinding {
  readonly connectionString: string;
}

interface Env {
  readonly APP_ENV: string;
  readonly HYPERDRIVE?: HyperdriveBinding;
}

type DatabaseProbe = (connectionString: string) => Promise<void>;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    headers: {
      "cache-control": "no-store",
    },
    status,
  });
}

export function createApiWorker(databaseProbe: DatabaseProbe = probeDatabase) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const environment = isAppEnvironment(env.APP_ENV) ? env.APP_ENV : "unknown";

      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          application: "api",
          database: env.HYPERDRIVE ? "configured" : "not-configured",
          environment,
          runtime: "cloudflare-workers",
          status: "ok",
        });
      }

      if (request.method === "GET" && url.pathname === "/health/database") {
        if (!env.HYPERDRIVE) {
          return json(
            {
              database: "not-configured",
              status: "unavailable",
            },
            503,
          );
        }

        try {
          await databaseProbe(env.HYPERDRIVE.connectionString);
          return json({ database: "reachable", status: "ok" });
        } catch {
          return json({ database: "unreachable", status: "unavailable" }, 503);
        }
      }

      return json({ status: "not-found" }, 404);
    },
  };
}

export default createApiWorker() satisfies ExportedHandler<Env>;
