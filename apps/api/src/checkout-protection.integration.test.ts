import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Client } from "pg";
import {
  checkoutDigest,
  parseCheckoutIntent,
  record,
  signCheckoutRequest,
  type CheckoutAttestation,
  type CheckoutIntent,
} from "@provide/contracts";
import { createApiWorker } from "./index.js";
import { isolatedCheckoutSettings } from "./checkout-integration-fixture.js";
import { postgresCheckoutProtection } from "./checkout-protection-database.js";
import type { SandboxProvider } from "./stripe-sandbox.js";
const database = process.env.TEST_DATABASE_URL;
const scope = { restaurantSlug: "o3-native-restaurant-a", locationSlug: "o3-native-a-mitte" };
const base = `https://api.test/v1/storefront/${scope.restaurantSlug}/${scope.locationSlug}`;
const restaurant = "d2000000-0000-0000-0000-000000000001",
  location = "d3000000-0000-0000-0000-000000000001";
interface Binding {
  hash: string;
  intent: CheckoutIntent;
}
function cloneFixture(sql: string): string {
  return (
    sql
      .replace(/\bf([0-9a-f]{7}-)/g, "d$1")
      // Auth emails are globally unique, not scoped by the cloned UUIDs. Keep all
      // synthetic identities/slugs independent from the subsequent legacy suite.
      .replaceAll("storefront-", "o3-native-")
  );
}
describe.skipIf(!database)(
  "O3 native dispatcher / real PG (local challenge and payment adapters)",
  () => {
    let admin: Client;
    let worker: ReturnType<typeof createApiWorker>;
    let providerCalls = 0;
    let env: Parameters<ReturnType<typeof createApiWorker>["fetch"]>[1];
    let sequence = 0;
    const network = ["1".repeat(64), "2".repeat(64)];
    const command = () => ({
      menuId: "d4000000-0000-0000-0000-000000000001",
      menuVersionId: "d5000000-0000-0000-0000-000000000001",
      requestedFor: new Date(
        Math.floor(Date.now() / 3600000) * 3600000 + 4 * 3600000 + (sequence++ % 8) * 900000,
      ).toISOString(),
      lines: [{ menuItemId: "d6000000-0000-0000-0000-000000000001", quantity: 2 }],
      submissionKey: crypto.randomUUID(),
      customer: {
        contactName: "Synthetic O3",
        phoneE164: "+999100000051",
        email: "o3-native@example.invalid",
      },
      privacyNoticeVersion: "preview-v1",
    });
    async function post(
      resource: string,
      body: unknown,
      hash: string | null = null,
      fresh = false,
      overrides: Partial<typeof env> = {},
      nonce = crypto.randomUUID(),
    ) {
      const text = JSON.stringify(body),
        at = Date.now();
      const a: CheckoutAttestation = {
        at,
        nonce,
        context: hash,
        freshContext: fresh,
        network,
        epoch: Math.floor(at / 600000),
      };
      const r = new Request(base + "/" + resource, { method: "POST" });
      return worker.fetch(
        new Request(r, {
          headers: await signCheckoutRequest(
            r,
            text,
            a,
            isolatedCheckoutSettings.CHECKOUT_GATEWAY_SECRET,
          ),
          body: text,
        }),
        { ...env, ...overrides },
      );
    }
    async function binding(key: string): Promise<Binding> {
      const hash = await checkoutDigest(crypto.randomUUID());
      expect((await post("checkout-context", {}, hash, true)).status).toBe(200);
      const response = await post(
        "checkout-session",
        {
          issueId: crypto.randomUUID(),
          submissionKey: key,
          challenge: "local-" + crypto.randomUUID(),
        },
        hash,
      );
      expect(response.status).toBe(201);
      const intent = parseCheckoutIntent(record(await response.json())?.data);
      if (!intent) throw Error("Invalid isolated intent");
      return { hash, intent };
    }
    async function receipt(b: Binding) {
      return post(
        "checkout-receipt",
        { sessionId: b.intent.sessionId, submissionKey: b.intent.submissionKey },
        b.hash,
      );
    }
    beforeAll(async () => {
      if (!database || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(database).hostname))
        throw Error("O3 evidence requires an explicit isolated loopback database");
      admin = new Client({ connectionString: database });
      await admin.connect();
      await admin.query(
        cloneFixture(
          await readFile(
            new URL("../../../supabase/tests/fixtures/storefront.fixture.inc", import.meta.url),
            "utf8",
          ),
        ),
      );
      await admin.query(
        cloneFixture(
          await readFile(
            new URL("../../../supabase/tests/fixtures/delivery.fixture.inc", import.meta.url),
            "utf8",
          ),
        ),
      );
      const policy = await admin.query<{ id: string }>(
        "select private.create_delivery_policy($1,'aal2',$2,$3,$4::jsonb) as id",
        [
          "d1000000-0000-0000-0000-000000000001",
          restaurant,
          location,
          JSON.stringify([
            { postalCodes: ["52062"], minimumAmountMinor: 2500, feeAmountMinor: 350 },
          ]),
        ],
      );
      await admin.query("select private.publish_delivery_policy($1,'aal2',$2,$3,$4)", [
        "d1000000-0000-0000-0000-000000000001",
        restaurant,
        location,
        policy.rows[0]!.id,
      ]);
      await admin.query(
        "insert into public.restaurant_feature_flags(restaurant_id,feature_key,enabled) values($1,'payment.online',true)",
        [restaurant],
      );
      const provider: SandboxProvider = {
        session: () => {
          providerCalls++;
          return Promise.reject(Error("No external provider allowed"));
        },
        expire: () => {
          providerCalls++;
          return Promise.reject(Error("No external provider allowed"));
        },
        refund: () => {
          providerCalls++;
          return Promise.reject(Error("No external provider allowed"));
        },
      };
      const args: Parameters<typeof createApiWorker> = [];
      args[12] = provider;
      args[25] = { verify: () => Promise.resolve(true) };
      worker = createApiWorker(...args);
      env = {
        APP_ENV: "test",
        ...isolatedCheckoutSettings,
        HYPERDRIVE: { connectionString: database },
        HYPERDRIVE_CACHE_DISABLED: "true",
        CHECKOUT_WRITE_ENABLED: "true",
        CHECKOUT_PRIVACY_NOTICE_VERSION: "preview-v1",
        CHECKOUT_RETENTION_DAYS: "30",
        ORDER_STATUS_READ_ENABLED: "true",
        ORDER_STATUS_TOKEN_SECRET: "synthetic-native-o3-status-secret-at-least-32",
        CART_QUOTE_ENABLED: "true",
        DELIVERY_ORDERING_ENABLED: "true",
        ONLINE_PAYMENT_ENABLED: "true",
        ONLINE_PAYMENT_PROCESSING_ENABLED: "true",
        STRIPE_TEST_SECRET_KEY: "sk_test_synthetic",
        STRIPE_TEST_ACCOUNT_ID: "acct_synthetic",
        STRIPE_TEST_WEBHOOK_SECRET: "whsec_synthetic",
        PAYMENT_RETURN_ORIGIN: "https://storefront.test",
        PAYMENT_ACCESS_SECRET: "synthetic-native-o3-payment-secret-at-least-32",
      };
    }, 30000);
    afterAll(async () => {
      if (admin) await admin.end();
    });
    it.each(["orders", "delivery-orders", "online-orders"])(
      "O3-T09/T16/T45 true commit, discarded result and same %s receipt have one effect",
      async (mode) => {
        const c = command();
        const b = await binding(c.submissionKey);
        let value: unknown = c;
        if (mode !== "orders") {
          const quoteResponse = await post(
            "delivery-quote",
            {
              menuId: c.menuId,
              menuVersionId: c.menuVersionId,
              requestedFor: c.requestedFor,
              lines: c.lines,
              postalCode: "52062",
            },
            b.hash,
          );
          expect(quoteResponse.status).toBe(200);
          const quote = record(await quoteResponse.json())?.data;
          value =
            mode === "delivery-orders"
              ? {
                  ...c,
                  delivery: {
                    addressLine1: "Synthetic Testweg 3",
                    addressLine2: null,
                    postalCode: "52062",
                    city: "Aachen",
                    countryCode: "DE",
                  },
                  expectedQuote: quote,
                }
              : { ...c, fulfillmentType: "pickup" };
        }
        const first = await post(mode, { sessionId: b.intent.sessionId, command: value }, b.hash);
        expect(first.status).toBe(201);
        const firstData = record(await first.json())?.data;
        // Drop this actual committed response from the caller's recovery state, then read/replay.
        const recovered = await receipt(b);
        expect(recovered.status).toBe(200);
        expect(record(record(await recovered.json())?.data)?.confirmation).toEqual(firstData);
        const replay = await post(
          mode,
          { sessionId: b.intent.sessionId, command: value },
          b.hash,
          false,
          {
            CHECKOUT_WRITE_ENABLED: "false",
            DELIVERY_ORDERING_ENABLED: "false",
            ONLINE_PAYMENT_ENABLED: "false",
          },
        );
        expect(replay.status).toBe(200);
        expect(record(await replay.json())?.data).toEqual(firstData);
        const counts = await admin.query<{
          orders: number;
          payments: number;
          claims: number;
          jobs: number;
        }>(
          "select (select count(*)::integer from public.orders where restaurant_id=$1 and submission_key=$2) orders,(select count(*)::integer from public.order_payments where order_id=(select id from public.orders where restaurant_id=$1 and submission_key=$2)) payments,(select count(*)::integer from public.ordering_capacity_claims where id=(select capacity_claim_id from public.orders where restaurant_id=$1 and submission_key=$2)) claims,(select count(*)::integer from public.online_payment_jobs where order_id=(select id from public.orders where restaurant_id=$1 and submission_key=$2)) jobs",
          [restaurant, c.submissionKey],
        );
        expect(counts.rows[0]).toEqual({
          orders: 1,
          payments: 1,
          claims: 1,
          jobs: mode === "online-orders" ? 1 : 0,
        });
        expect(providerCalls).toBe(0);
      },
      15000,
    );
    it("O3-T10/T11/T12/T13 two real connections commit one intent and reject every altered payload/binding", async () => {
      const c = command(),
        b = await binding(c.submissionKey);
      const responses = await Promise.all([
        post("orders", { sessionId: b.intent.sessionId, command: c }, b.hash),
        post("orders", { sessionId: b.intent.sessionId, command: c }, b.hash),
      ]);
      expect(responses.every((r) => r.ok)).toBe(true);
      const confirmations = await Promise.all(
        responses.map(async (r) => record(await r.json())?.data),
      );
      expect(confirmations[0]).toEqual(confirmations[1]);
      for (const change of [
        { lines: [{ ...c.lines[0]!, quantity: 3 }] },
        { customer: { ...c.customer, contactName: "Changed" } },
        { requestedFor: new Date(Date.parse(c.requestedFor) + 900000).toISOString() },
      ])
        expect(
          (
            await post(
              "orders",
              { sessionId: b.intent.sessionId, command: { ...c, ...change } },
              b.hash,
            )
          ).status,
        ).toBe(409);
      expect(
        (
          await post(
            "orders",
            {
              sessionId: b.intent.sessionId,
              command: { ...c, submissionKey: crypto.randomUUID() },
            },
            b.hash,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await post(
            "orders",
            { sessionId: b.intent.sessionId, command: c },
            await checkoutDigest(crypto.randomUUID()),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await admin.query<{ n: number }>(
            "select count(*)::integer n from public.orders where restaurant_id=$1 and submission_key=$2",
            [restaurant, c.submissionKey],
          )
        ).rows[0]?.n,
      ).toBe(1);
    }, 15000);
    it("O3-T07 renewal waits for an in-flight commit and cannot open a second order", async () => {
      const c = command(),
        b = await binding(c.submissionKey);
      await admin.query("BEGIN");
      await admin.query("select id from private.checkout_sessions where id=$1 for update", [
        b.intent.sessionId,
      ]);
      const submit = post("orders", { sessionId: b.intent.sessionId, command: c }, b.hash);
      const observer = new Client({ connectionString: database! });
      await observer.connect();
      let locked = true;
      let renew: Promise<Response> | undefined;
      try {
        const deadline = Date.now() + 3000;
        for (;;) {
          const waiting = await observer.query<{ n: number }>(
            "select count(*)::integer n from pg_stat_activity where query like '%private.checkout_submit(%' and wait_event_type='Lock'",
          );
          if (waiting.rows[0]!.n > 0) break;
          if (Date.now() > deadline) throw Error("Commit did not reach the native session lock");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        renew = post(
          "checkout-session",
          {
            issueId: crypto.randomUUID(),
            submissionKey: crypto.randomUUID(),
            challenge: "local-renew-" + crypto.randomUUID(),
            renewSessionId: b.intent.sessionId,
          },
          b.hash,
        );
        await admin.query("COMMIT");
        locked = false;
        expect((await submit).status).toBe(201);
        expect((await renew).status).toBe(409);
      } finally {
        if (locked) await admin.query("ROLLBACK");
        await Promise.allSettled([submit, ...(renew ? [renew] : [])]);
        await observer.end();
      }
      expect((await receipt(b)).status).toBe(200);
      expect(
        (
          await admin.query<{ n: number }>(
            "select count(*)::integer n from private.checkout_sessions where verifier_hash=$1",
            [b.hash],
          )
        ).rows[0]?.n,
      ).toBe(1);
    }, 15000);
    it("O3-T14/T31 actual transaction rejection leaves no partial receipt and rate 429 has no writer effect", async () => {
      const c = command(),
        b = await binding(c.submissionKey);
      expect(
        (
          await post(
            "orders",
            {
              sessionId: b.intent.sessionId,
              command: { ...c, menuVersionId: crypto.randomUUID() },
            },
            b.hash,
          )
        ).status,
      ).toBe(409);
      const row = await admin.query<{ order_id: string | null; receipt: unknown }>(
        "select order_id,receipt from private.checkout_sessions where id=$1",
        [b.intent.sessionId],
      );
      expect(row.rows[0]).toEqual({ order_id: null, receipt: null });
      const primary = "primary:write:" + (await checkoutDigest(`${b.hash}:${b.intent.sessionId}`));
      await admin.query(
        "update private.checkout_rate_buckets set tokens=0,updated_at=clock_timestamp() where bucket_key=$1",
        [primary],
      );
      const blocked = await post("orders", { sessionId: b.intent.sessionId, command: c }, b.hash);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toMatch(/^[1-9][0-9]?$/);
      expect(
        (
          await admin.query<{ n: number }>(
            "select count(*)::integer n from public.orders where restaurant_id=$1 and submission_key=$2",
            [restaurant, c.submissionKey],
          )
        ).rows[0]?.n,
      ).toBe(0);
    }, 15000);
    it("O3-T21/T26/T50 atomic nonce and last token withstand separate connection races", async () => {
      const key = "o3-concurrent-last-token",
        nonce = crypto.randomUUID();
      const budget = [{ key, capacity: 5, period: 600 as const }];
      const once = await Promise.all([
        postgresCheckoutProtection.guard(database!, nonce, Date.now(), budget),
        postgresCheckoutProtection.guard(database!, nonce, Date.now(), budget),
      ]);
      expect(once.map((r) => record(r)?.outcome).sort()).toEqual(["allowed", "forbidden"]);
      await admin.query(
        "update private.checkout_rate_buckets set tokens=1,updated_at=clock_timestamp() where bucket_key=$1",
        [key],
      );
      const start = Date.now();
      const races = await Promise.all(
        Array.from({ length: 20 }, () =>
          postgresCheckoutProtection.guard(database!, crypto.randomUUID(), Date.now(), budget),
        ),
      );
      expect(races.filter((r) => record(r)?.outcome === "allowed")).toHaveLength(1);
      expect(races.filter((r) => record(r)?.outcome === "limited")).toHaveLength(19);
      console.info(
        "O3 isolated bounded load",
        JSON.stringify({ requests: 20, allowed: 1, elapsedMs: Date.now() - start }),
      );
      expect(providerCalls).toBe(0);
    }, 15000);
    it("O3-T35 real concurrent issue claims produce one session and return its identical public receipt", async () => {
      const hash = await checkoutDigest(crypto.randomUUID());
      expect((await post("checkout-context", {}, hash, true)).status).toBe(200);
      const issue = {
        issueId: crypto.randomUUID(),
        submissionKey: crypto.randomUUID(),
        challenge: "local-issue-race-" + crypto.randomUUID(),
      };
      const responses = await Promise.all([
        post("checkout-session", issue, hash),
        post("checkout-session", issue, hash),
      ]);
      expect(responses.every((r) => r.ok)).toBe(true);
      const intents = await Promise.all(responses.map(async (r) => record(await r.json())?.data));
      expect(intents[0]).toEqual(intents[1]);
      expect(
        (
          await admin.query<{ n: number }>(
            "select count(*)::integer n from private.checkout_sessions where verifier_hash=$1",
            [hash],
          )
        ).rows[0]?.n,
      ).toBe(1);
      expect(
        (
          await admin.query<{ n: number }>(
            "select count(*)::integer n from public.orders where restaurant_id=$1 and submission_key=$2",
            [restaurant, issue.submissionKey],
          )
        ).rows[0]?.n,
      ).toBe(0);
    }, 15000);
    it("O3-T32/T49 retained capacities fail closed without evicting a committed receipt; physical cleanup is bounded", async () => {
      const committed = (
        await admin.query<{ verifier_hash: string; id: string; submission_key: string }>(
          "select verifier_hash,id,submission_key from private.checkout_sessions where restaurant_id=$1 and order_id is not null limit 1",
          [restaurant],
        )
      ).rows[0]!;
      const fresh = await checkoutDigest(crypto.randomUUID());
      const started = Date.now();
      await admin.query("BEGIN");
      try {
        await admin.query("select private.checkout_context($1,true)", [fresh]);
        const count = (
          await admin.query<{ n: number }>(
            "select count(*)::integer n from private.checkout_sessions",
          )
        ).rows[0]!.n;
        await admin.query(
          `insert into private.checkout_sessions(verifier_hash,restaurant_id,location_id,submission_key,created_at,write_expires_at,receipt_expires_at,purge_at)
          select $1,$2,$3,'capacity-fixture-'||n,t,t+interval '30 minutes',t+interval '90 minutes',t+interval '25 hours 25 minutes' from generate_series(1,$4::integer)n cross join lateral (select clock_timestamp() t)clock`,
          [committed.verifier_hash, restaurant, location, 10000 - count],
        );
        const challengeHash = await checkoutDigest(crypto.randomUUID()),
          issue = crypto.randomUUID(),
          bindingHmac = "b".repeat(43);
        await admin.query("select private.checkout_issue_begin($1,$2,$3,$4)", [
          challengeHash,
          issue,
          bindingHmac,
          fresh,
        ]);
        const issueResult = await admin.query<{ data: { outcome: string } }>(
          "select private.checkout_issue_finish($1,$2,$3,$4,$5,$6,$7,null,true) data",
          [
            challengeHash,
            issue,
            bindingHmac,
            fresh,
            scope.restaurantSlug,
            scope.locationSlug,
            crypto.randomUUID(),
          ],
        );
        expect(issueResult.rows[0]!.data.outcome).toBe("unavailable");
        const existing = await admin.query<{ data: { outcome: string } }>(
          "select private.checkout_receipt($1,$2,$3,$4,$5) data",
          [
            committed.verifier_hash,
            committed.id,
            scope.restaurantSlug,
            scope.locationSlug,
            committed.submission_key,
          ],
        );
        expect(existing.rows[0]!.data.outcome).toBe("committed");
        // Separate capacity fixtures for rate and nonce stores; rollback restores every prior record.
        await admin.query("delete from private.checkout_rate_buckets");
        await admin.query(
          "insert into private.checkout_rate_buckets select 'cap:'||n,5,600,5,clock_timestamp(),clock_timestamp()+interval '20 minutes' from generate_series(1,100000)n",
        );
        const limited = await admin.query<{ data: { outcome: string } }>(
          'select private.checkout_guard(gen_random_uuid(),clock_timestamp(),\'[{"key":"new-over-cap","capacity":5,"period":600}]\') data',
        );
        expect(limited.rows[0]!.data.outcome).toBe("unavailable");
        await admin.query("delete from private.checkout_gateway_nonces");
        await admin.query(
          "insert into private.checkout_gateway_nonces select gen_random_uuid(),clock_timestamp()+interval '30 seconds',clock_timestamp()+interval '10 minutes 30 seconds' from generate_series(1,100000)n",
        );
        const nonceCap = await admin.query<{ data: { outcome: string } }>(
          'select private.checkout_guard(gen_random_uuid(),clock_timestamp(),\'[{"key":"cap:1","capacity":5,"period":600}]\') data',
        );
        expect(nonceCap.rows[0]!.data.outcome).toBe("unavailable");
        await admin.query(
          "update private.checkout_gateway_nonces set purge_at=clock_timestamp()-interval '1 second'",
        );
        await admin.query(
          "update private.checkout_rate_buckets set purge_at=clock_timestamp()-interval '1 second'",
        );
        const cleanupStart = Date.now();
        for (let n = 0; n < 100; n++) await admin.query("select private.checkout_cleanup(1000)");
        expect(
          (
            await admin.query<{ n: number }>(
              "select count(*)::integer n from private.checkout_gateway_nonces",
            )
          ).rows[0]!.n,
        ).toBe(0);
        expect(
          (
            await admin.query<{ n: number }>(
              "select count(*)::integer n from private.checkout_rate_buckets",
            )
          ).rows[0]!.n,
        ).toBe(0);
        console.info(
          "O3 bounded retained capacity",
          JSON.stringify({
            sessions: 10000,
            rateKeys: 100000,
            nonces: 100000,
            batches: 100,
            cleanupMs: Date.now() - cleanupStart,
            elapsedMs: Date.now() - started,
          }),
        );
      } finally {
        await admin.query("ROLLBACK");
      }
    }, 30000);
  },
);
