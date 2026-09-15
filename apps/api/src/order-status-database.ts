import { Client } from "pg";
import type { OrderStatusReader } from "./order-status.js";

export const postgresOrderStatusReader: OrderStatusReader = {
  async read(connectionString, scope, orderId) {
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 6000,
    });
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL ROLE service_role");
      await client.query("SET LOCAL statement_timeout = '5s'");
      const result = await client.query<{ data: unknown }>(
        "SELECT private.read_public_guest_order_status($1::text,$2::text,$3::uuid) AS data",
        [scope.restaurantSlug, scope.locationSlug, orderId],
      );
      await client.query("COMMIT");
      if (result.rows.length !== 1) throw new Error("Unexpected public status result");
      return result.rows[0]?.data;
    } finally {
      await client.end();
    }
  },
};
