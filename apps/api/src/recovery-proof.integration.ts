import { createHmac } from "node:crypto";
import { expect } from "vitest";
import {
  handleAccountRecovery,
  postgresRecovery,
  supabaseRecoveryEffect,
  type RecoveryProvider,
  type RecoveryRepository,
} from "./account-recovery.js";
import { supabaseDashboardTokenVerifier } from "./dashboard-auth.js";
import { parseRecoveryCase, type RecoveryCommand } from "@provide/contracts";
import { createApiWorker } from "./index.js";
const db = process.env.TEST_DATABASE_URL,
  url = process.env.TEST_REALTIME_URL,
  key = process.env.TEST_AUTH_ADMIN_KEY;
export function totp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=/g, "").toUpperCase()) {
    const n = alphabet.indexOf(c);
    if (n < 0) throw Error("Invalid synthetic TOTP secret");
    bits += n.toString(2).padStart(5, "0");
  }
  const bytes = Uint8Array.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(Date.now() / 30000)));
  const hmac = createHmac("sha1", bytes).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 15;
  return (
    (new DataView(hmac.buffer, hmac.byteOffset, hmac.byteLength).getUint32(offset) & 0x7fffffff) %
    1000000
  )
    .toString()
    .padStart(6, "0");
}

export async function actualResponse(
  token: string,
  command: RecoveryCommand,
  password?: string,
  options?: { provider?: RecoveryProvider; repository?: RecoveryRepository },
) {
  if (
    !db ||
    !url ||
    !key ||
    ![db, url].every((v) => ["127.0.0.1", "localhost"].includes(new URL(v).hostname))
  )
    throw Error("Explicit disposable loopback stack required");
  const env = {
    DASHBOARD_AUTH_ENABLED: "true",
    ACCOUNT_RECOVERY_ENABLED: "true",
    ACCOUNT_RECOVERY_ORIGIN: "http://127.0.0.1:4321",
    SUPABASE_AUTH_ISSUER: `${url}/auth/v1`,
    SUPABASE_AUTH_AUDIENCE: "authenticated",
    SUPABASE_SERVICE_ROLE_KEY: key,
    HYPERDRIVE_CACHE_DISABLED: "true",
    HYPERDRIVE: { connectionString: db },
  };
  return handleAccountRecovery(
    new Request("https://isolated-api.test/v1/account/recovery", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        origin: env.ACCOUNT_RECOVERY_ORIGIN,
      },
      body: JSON.stringify({ command, ...(password ? { password } : {}) }),
    }),
    env,
    supabaseDashboardTokenVerifier,
    { requestId: crypto.randomUUID() },
    { error: () => undefined },
    new Headers(),
    options?.repository ?? postgresRecovery,
    options?.provider ?? supabaseRecoveryEffect,
  );
}
export async function actualCommand(
  token: string,
  command: RecoveryCommand,
  password?: string,
  options?: { provider?: RecoveryProvider; repository?: RecoveryRepository },
) {
  const response = await actualResponse(token, command, password, options);
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  const c =
    body && typeof body === "object" && "data" in body ? parseRecoveryCase(body.data) : undefined;
  if (!c) throw Error("No isolated recovery projection");
  return c;
}

/** Full HTTP handlers and production JWT verifier, never an injected identity. */
export async function actualBusinessDenied(
  token: string,
  restaurantId: string,
  locationId: string,
) {
  if (
    !db ||
    !url ||
    ![db, url].every((v) => ["127.0.0.1", "localhost"].includes(new URL(v).hostname))
  )
    throw Error("Loopback stack required");
  const env = {
    APP_ENV: "test",
    DASHBOARD_AUTH_ENABLED: "true",
    DASHBOARD_ORDER_OPERATIONS_ENABLED: "true",
    DASHBOARD_ORDER_ALERTS_ENABLED: "true",
    DASHBOARD_MENU_ENABLED: "true",
    DASHBOARD_LOCATION_OPERATIONS_ENABLED: "true",
    DASHBOARD_HISTORY_ENABLED: "true",
    DASHBOARD_PERSONNEL_ENABLED: "true",
    PROVIDE_ADMIN_ENABLED: "true",
    HYPERDRIVE_CACHE_DISABLED: "true",
    HYPERDRIVE: { connectionString: db },
    SUPABASE_AUTH_ISSUER: `${url}/auth/v1`,
    SUPABASE_AUTH_AUDIENCE: "authenticated",
    API_ALLOWED_ORIGINS: "http://127.0.0.1:4321",
  };
  const base = `/v1/dashboard/restaurants/${restaurantId}/locations/${locationId}`;
  const worker = createApiWorker();
  const routes: Array<[string, unknown?]> = [
    ["/v1/dashboard/access-context"],
    [`${base}/orders`],
    [`${base}/orders/${crypto.randomUUID()}`],
    [`${base}/order-alerts`],
    [`${base}/menu`],
    [`${base}/operations`],
    [`${base}/history`, {}],
    ["/v1/dashboard/personnel", { action: "read", restaurantId }],
    ["/v1/provide/administration", { action: "read", restaurantId }],
  ];
  for (const [path, body] of routes) {
    const response = await worker.fetch(
      new Request(`https://isolated-api.test${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${token}`,
          origin: env.API_ALLOWED_ORIGINS,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
    if (path.endsWith("access-context")) {
      expect(response.status, path).toBe(200);
      const projection: unknown = await response.json();
      expect(projection).toMatchObject({ data: { memberships: [] } });
    } else expect(response.status, path).toBe(403);
  }
}
