import { lockAccountSession } from "./account-session.js";
import { Client } from "pg";

import type { DashboardAccessReader } from "./dashboard-access.js";

export const postgresDashboardAccessReader: DashboardAccessReader = {
  async read(connectionString, userId, aal, sessionId) {
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 6000,
    });
    try {
      await client.connect();
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE service_role");
      if (
        !(await lockAccountSession(client, { userId, aal, ...(sessionId ? { sessionId } : {}) }))
      ) {
        await client.query("ROLLBACK");
        return { aal, memberships: [] };
      }
      await client.query("SET LOCAL statement_timeout = '5s'");
      const result = await client.query<{ data: unknown }>(
        "SELECT private.read_dashboard_access_context($1::uuid,$2::text) AS data",
        [userId, aal],
      );
      await client.query("COMMIT");
      if (result.rows.length !== 1) throw new Error("Unexpected dashboard access result");
      return result.rows[0]?.data;
    } finally {
      await client.end();
    }
  },
};
