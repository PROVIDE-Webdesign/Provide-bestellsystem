import type { Client } from "pg";
import type { DashboardIdentity } from "./dashboard-auth.js";

/** Must run inside the same uncached transaction as the subsequent business operation. */
export async function lockAccountSession(
  client: Client,
  identity: DashboardIdentity,
): Promise<boolean> {
  if (!identity.sessionId) return false;
  const result = await client.query<{ live: boolean }>(
    "select private.lock_account_session($1::uuid,$2::text,$3::text) as live",
    [identity.userId, identity.sessionId, identity.aal],
  );
  return result.rows[0]?.live === true;
}
