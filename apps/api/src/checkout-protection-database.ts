import { Client } from "pg";
import type { StorefrontScope, CheckoutIssueRequest } from "@provide/contracts";
export interface CheckoutBudget {
  key: string;
  capacity: number;
  period: 60 | 600;
}
export interface CheckoutProtectionRepository {
  guard(
    connection: string,
    nonce: string,
    at: number,
    budgets: readonly CheckoutBudget[],
  ): Promise<unknown>;
  context(
    connection: string,
    hash: string,
    createNew: boolean,
    scope: StorefrontScope,
  ): Promise<unknown>;
  beginIssue(
    connection: string,
    challengeHash: string,
    issue: CheckoutIssueRequest,
    binding: string,
    hash: string,
  ): Promise<unknown>;
  finishIssue(
    connection: string,
    challengeHash: string,
    issue: CheckoutIssueRequest,
    binding: string,
    hash: string,
    scope: StorefrontScope,
    valid: boolean,
  ): Promise<unknown>;
  receipt(
    connection: string,
    hash: string,
    session: string,
    scope: StorefrontScope,
    key: string,
  ): Promise<unknown>;
  submit(
    connection: string,
    hash: string,
    session: string,
    scope: StorefrontScope,
    mode: string,
    fingerprint: string,
    command: unknown,
    retention: number,
    account: string | null,
  ): Promise<unknown>;
  cleanup(connection: string): Promise<unknown>;
}
async function query(connectionString: string, sql: string, values: unknown[]): Promise<unknown> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 9000,
  });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    await client.query("SET LOCAL statement_timeout='8s'");
    const result = await client.query<{ data: unknown }>(sql, values);
    if (result.rows.length !== 1) throw new Error("Invalid checkout boundary result");
    await client.query("COMMIT");
    return result.rows[0]!.data;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
export const postgresCheckoutProtection: CheckoutProtectionRepository = {
  guard: (c, n, a, b) =>
    query(c, "select private.checkout_guard($1::uuid,$2::timestamptz,$3::jsonb) as data", [
      n,
      new Date(a).toISOString(),
      JSON.stringify(b),
    ]),
  context: (c, h, n, s) =>
    query(c, "select private.checkout_context($1,$2,$3,$4) as data", [
      h,
      n,
      s.restaurantSlug,
      s.locationSlug,
    ]),
  beginIssue: (c, ch, i, b, h) =>
    query(c, "select private.checkout_issue_begin($1,$2::uuid,$3,$4) as data", [
      ch,
      i.issueId,
      b,
      h,
    ]),
  finishIssue: (c, ch, i, b, h, s, v) =>
    query(
      c,
      "select private.checkout_issue_finish($1,$2::uuid,$3,$4,$5,$6,$7,$8::uuid,$9) as data",
      [
        ch,
        i.issueId,
        b,
        h,
        s.restaurantSlug,
        s.locationSlug,
        i.submissionKey,
        i.renewSessionId ?? null,
        v,
      ],
    ),
  receipt: (c, h, id, s, k) =>
    query(c, "select private.checkout_receipt($1,$2::uuid,$3,$4,$5) as data", [
      h,
      id,
      s.restaurantSlug,
      s.locationSlug,
      k,
    ]),
  submit: (c, h, id, s, m, f, cmd, r, a) =>
    query(c, "select private.checkout_submit($1,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8,$9) as data", [
      h,
      id,
      s.restaurantSlug,
      s.locationSlug,
      m,
      f,
      JSON.stringify(cmd),
      r,
      a,
    ]),
  cleanup: (c) => query(c, "select private.checkout_cleanup(1000) as data", []),
};
