import { selectionLinesForDatabase } from "@provide/contracts";
import { Client } from "pg";
import type { OnlineOrderRequest, StorefrontScope, OnlinePaymentMode } from "@provide/contracts";
export interface OnlineJob {
  id: string;
  order_id: string;
  account_id: string;
  stripe_mode?: OnlinePaymentMode;
  session_id: string | null;
  intent_id: string | null;
  capture_method?: "automatic" | "manual";
  capture_requested_at?: string | null;
  acceptance_deadline?: string | null;
  refund_id: string | null;
  refund_state: string;
  refund_sequence: number;
  close_requested: string | null;
  provider_terminal: boolean;
  deadline: string;
  created_at: string;
  amount: number;
  currency: string;
  payment_status: string;
  order_status: string;
  restaurant_slug: string;
  location_slug: string;
  last_error: string | null;
}
export interface OnlineRepository {
  submit(
    connection: string,
    scope: StorefrontScope,
    command: OnlineOrderRequest,
    retention: number,
    account: string,
    mode?: OnlinePaymentMode,
  ): Promise<unknown>;
  read(
    connection: string,
    account: string,
    order: string,
    mode?: OnlinePaymentMode,
  ): Promise<OnlineJob | null>;
  resume(
    connection: string,
    account: string,
    order: string,
    mode?: OnlinePaymentMode,
  ): Promise<boolean>;
  claim(
    connection: string,
    account: string,
    order: string | null,
    lease: string,
    mode?: OnlinePaymentMode,
  ): Promise<OnlineJob | null>;
  bind(connection: string, job: string, lease: string, session: string): Promise<void>;
  sync(
    connection: string,
    job: string,
    lease: string,
    state: string,
    intent: string | null,
    refund: string | null,
    digest: string,
  ): Promise<void>;
  rejectCreation(
    connection: string,
    job: string,
    lease: string,
    requestId: string,
    payloadSha256: string,
    mode?: OnlinePaymentMode,
  ): Promise<void>;
  fail(connection: string, job: string, lease: string, manual: boolean): Promise<void>;
  event(
    connection: string,
    account: string,
    event: string,
    type: string,
    object: string,
    digest: string,
    occurredAt: string,
    merchantAccount?: string,
    paymentSucceeded?: boolean,
    mode?: OnlinePaymentMode,
  ): Promise<string | null>;
}
async function query<T>(
  connectionString: string,
  sql: string,
  values: unknown[],
  manualCapture = false,
): Promise<T> {
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
    if (manualCapture)
      await client.query("select set_config('provide.manual_capture', 'on', true)");
    const r = await client.query<{ data: T }>(sql, values);
    await client.query("COMMIT");
    return r.rows[0]!.data;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}
export const postgresOnlineRepository: OnlineRepository = {
  rejectCreation: (c, j, l, r, d, mode = "test") =>
    query(c, "select private.reject_online_payment_creation($1,$2,$3,$4,$5) as data", [
      j,
      l,
      r,
      d,
      mode,
    ]),
  submit(c, s, v, retention, account, mode = "test") {
    const d = v.fulfillmentType === "delivery" ? v.delivery : null;
    return query(
      c,
      "select private.attach_order_number(private.submit_public_guest_online_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)) as data",
      [
        s.restaurantSlug,
        s.locationSlug,
        v.menuId,
        v.menuVersionId,
        v.requestedFor,
        JSON.stringify(selectionLinesForDatabase(v.lines)),
        v.submissionKey,
        JSON.stringify({
          contact_name: v.customer.contactName,
          phone_e164: v.customer.phoneE164,
          email: v.customer.email,
        }),
        v.fulfillmentType,
        d
          ? JSON.stringify({
              address_line_1: d.addressLine1,
              address_line_2: d.addressLine2,
              postal_code: d.postalCode,
              city: d.city,
              country_code: d.countryCode,
            })
          : null,
        v.fulfillmentType === "delivery" ? JSON.stringify(v.expectedQuote) : null,
        v.privacyNoticeVersion,
        retention,
        account,
        mode,
      ],
      true,
    );
  },
  read: (c, a, o, mode = "test") =>
    query(c, "select private.read_platform_online_payment_job($1,$2,$3) as data", [a, o, mode]),
  resume: (c, a, o, mode = "test") =>
    query(c, "select private.allow_platform_online_payment_resume($1,$2,$3) as data", [a, o, mode]),
  claim: (c, a, o, l, mode = "test") =>
    query(c, "select private.claim_platform_online_payment_job($1,$2,$3,$4) as data", [
      a,
      o,
      l,
      mode,
    ]),
  bind: (c, j, l, s) =>
    query(c, "select private.bind_online_payment_session($1,$2,$3) as data", [j, l, s]),
  sync: (c, j, l, s, i, r, d) =>
    query(c, "select private.sync_online_payment($1,$2,$3,$4,$5,$6) as data", [j, l, s, i, r, d]),
  fail: (c, j, l, m) =>
    query(c, "select private.fail_online_payment_job($1,$2,$3) as data", [j, l, m]),
  event: (
    c,
    a,
    e,
    t,
    o,
    d,
    occurredAt,
    merchantAccount = a,
    paymentSucceeded = false,
    mode = "test",
  ) =>
    query(
      c,
      "select private.receive_platform_online_payment_event($1,$2,$3,$4,$5,$6,$7,$8,$9) as data",
      [a, merchantAccount, e, t, o, d, occurredAt, paymentSucceeded, mode],
    ),
};
