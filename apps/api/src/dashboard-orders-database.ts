import { Client } from "pg";

import type { DashboardOrdersReader } from "./dashboard-orders.js";

async function query(
  connectionString: string,
  readOnly: boolean,
  sql: string,
  values: readonly unknown[],
) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
  });
  try {
    await client.connect();
    await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await client.query<{ data: unknown }>(sql, [...values]);
    await client.query("COMMIT");
    if (result.rows.length !== 1) throw new Error("Unexpected dashboard order result");
    return result.rows[0]?.data;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database failure.
    }
    throw error;
  } finally {
    await client.end();
  }
}

export const postgresDashboardOrdersReader: DashboardOrdersReader = {
  alerts(connectionString, identity, scope) {
    return query(
      connectionString,
      true,
      "select private.read_dashboard_acceptance($1::uuid,$2::text,$3::uuid,$4::uuid) as data",
      [identity.userId, identity.aal, scope.restaurantId, scope.locationId],
    );
  },
  async escalateAlerts(connectionString) {
    const result = await query(
      connectionString,
      false,
      "select private.escalate_order_acceptance(100) as data",
      [],
    );
    if (typeof result !== "number" || !Number.isInteger(result) || result < 0 || result > 100)
      throw Error("Invalid escalation result");
    return result;
  },
  communicate(connectionString, identity, scope, command) {
    return query(
      connectionString,
      false,
      "select private.update_order_communication($1::uuid,$2::text,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::integer,$8::text,$9::timestamptz) as data",
      [
        identity.userId,
        identity.aal,
        scope.restaurantId,
        scope.locationId,
        scope.orderId,
        command.expectedStatus,
        command.expectedRevision,
        command.action,
        "confirmedFor" in command ? command.confirmedFor : null,
      ],
    );
  },
  retryRefund(connectionString, identity, scope) {
    return query(
      connectionString,
      false,
      "select private.retry_online_refund($1,$2,$3,$4,$5) as data",
      [identity.userId, identity.aal, scope.restaurantId, scope.locationId, scope.orderId],
    );
  },
  list(connectionString, identity, scope, filters) {
    return query(
      connectionString,
      true,
      "SELECT private.attach_order_number(private.read_dashboard_orders_by_number($1::uuid,$2::text,$3::uuid,$4::uuid,$5::text,$6::timestamptz,$7::uuid,$8::integer,$9::text,$10::bigint)) AS data",
      [
        identity.userId,
        identity.aal,
        scope.restaurantId,
        scope.locationId,
        filters.status ?? null,
        filters.cursor?.requestedFor ?? null,
        filters.cursor?.orderId ?? null,
        filters.limit,
        filters.fulfillmentType ?? null,
        filters.orderNumber?.slice(3) ?? null,
      ],
    );
  },
  detail(connectionString, identity, scope) {
    return query(
      connectionString,
      true,
      "SELECT private.attach_order_number(private.read_dashboard_order($1::uuid,$2::text,$3::uuid,$4::uuid,$5::uuid)) AS data",
      [identity.userId, identity.aal, scope.restaurantId, scope.locationId, scope.orderId],
    );
  },
  transition(connectionString, identity, scope, command) {
    return query(
      connectionString,
      false,
      "SELECT private.transition_dashboard_order_with_reason($1::uuid,$2::text,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::text) AS data",
      [
        identity.userId,
        identity.aal,
        scope.restaurantId,
        scope.locationId,
        scope.orderId,
        command.expectedStatus,
        command.targetStatus,
        command.reasonCode ?? null,
      ],
    );
  },
};
