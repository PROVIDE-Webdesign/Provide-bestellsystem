import { parseEmailDispatchBatch } from "@provide/contracts";
import { Client } from "pg";
import type { EmailRepository } from "./email-notifications.js";

async function query(connectionString: string, sql: string, values: readonly unknown[]) {
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
    const r = await client.query<{ data: unknown }>(sql, [...values]);
    if (r.rows.length !== 1) throw new Error("Invalid email database result");
    await client.query("COMMIT");
    return r.rows[0]!.data;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* Preserve original failure. */
    }
    throw error;
  } finally {
    await client.end();
  }
}
export const postgresEmailRepository: EmailRepository = {
  async claim(connection, lock, limit, now) {
    const jobs = parseEmailDispatchBatch(
      await query(
        connection,
        "select private.claim_email_deliveries($1::uuid,$2::integer,$3::timestamptz) as data",
        [lock, limit, now],
      ),
    );
    if (!jobs) throw new Error("Invalid email projection");
    return jobs;
  },
  async finish(connection, id, lock, result, now) {
    const status = await query(
      connection,
      "select private.finish_email_delivery($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::timestamptz) as data",
      [
        id,
        lock,
        result.outcome,
        "code" in result ? result.code : null,
        "reference" in result ? result.reference : null,
        now,
      ],
    );
    if (
      typeof status !== "string" ||
      !["accepted", "retry", "uncertain", "dead_letter", "conflict"].includes(status)
    )
      throw new Error("Invalid email completion");
    return status;
  },
};
