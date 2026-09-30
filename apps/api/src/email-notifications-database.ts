import { parseEmailDispatchJob, type EmailDispatchJob } from "@provide/contracts";
import { Client } from "pg";
import type { EmailRepository } from "./email-notifications.js";

async function query(
  connectionString: string,
  sql: string,
  values: readonly unknown[],
  validate?: (data: unknown, client: Client) => Promise<unknown>,
) {
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
    const data = validate ? await validate(r.rows[0]!.data, client) : r.rows[0]!.data;
    await client.query("COMMIT");
    return data;
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
    return (await query(
      connection,
      "select private.claim_email_deliveries($1::uuid,$2::integer,$3::timestamptz) as data",
      [lock, limit, now],
      async (data, client) => {
        if (!Array.isArray(data) || data.length > limit || data.length > 25)
          throw new Error("Invalid email batch");
        const jobs: EmailDispatchJob[] = [];
        for (const value of data) {
          const source = value as Record<string, unknown> | null;
          if (
            !source ||
            typeof source.deliveryId !== "string" ||
            !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(source.deliveryId) ||
            source.lockToken !== lock ||
            (source.mode !== "send" && source.mode !== "reconcile")
          )
            throw new Error("Invalid email claim identity");
          const job = parseEmailDispatchJob(source);
          if (job) jobs.push(job);
          else {
            // Nothing has been sent. Isolate an invalid send instead of poisoning valid jobs.
            if (source.mode !== "send") throw new Error("Invalid email reconciliation");
            const finished = await client.query<{ data: string }>(
              "select private.finish_email_delivery($1::uuid,$2::uuid,'permanent_failure','invalid_projection',null,$3::timestamptz) as data",
              [source.deliveryId, lock, now],
            );
            if (finished.rows.length !== 1 || finished.rows[0]!.data !== "dead_letter")
              throw new Error("Invalid email isolation result");
          }
        }
        return jobs;
      },
    )) as EmailDispatchJob[];
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
