import { parseNotificationDispatchBatch } from "@provide/contracts";
import { Client } from "pg";

import type { NotificationAdapterResult, NotificationRepository } from "./notifications.js";

async function transaction<T>(connectionString: string, operation: (client: Client) => Promise<T>) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
  });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
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

export const postgresNotificationRepository: NotificationRepository = {
  claim(connectionString, lockToken, batchSize, now) {
    return transaction(connectionString, async (client) => {
      const result = await client.query<{ data: unknown }>(
        "SELECT private.claim_notification_deliveries($1::uuid,$2::integer,$3::timestamptz) AS data",
        [lockToken, batchSize, now],
      );
      const jobs = parseNotificationDispatchBatch(result.rows[0]?.data);
      if (!jobs || result.rows.length !== 1) throw new Error("Invalid notification claim result");
      return jobs;
    });
  },
  finish(connectionString, deliveryId, lockToken, result, now) {
    return transaction(connectionString, async (client) => {
      const errorCode = result.outcome === "accepted" ? null : result.code;
      const databaseResult = await client.query<{ status: string }>(
        "SELECT private.finish_notification_delivery($1::uuid,$2::uuid,$3::text,$4::text,$5::timestamptz) AS status",
        [deliveryId, lockToken, result.outcome, errorCode, now],
      );
      const status = databaseResult.rows[0]?.status;
      if (
        databaseResult.rows.length !== 1 ||
        !["sent", "retry", "dead_letter", "conflict"].includes(status ?? "")
      )
        throw new Error("Invalid notification completion result");
      return status as "sent" | "retry" | "dead_letter" | "conflict";
    });
  },
};

export type { NotificationAdapterResult };
