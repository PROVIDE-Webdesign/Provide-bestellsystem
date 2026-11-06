import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { describe, it, expect, vi } from "vitest";
import { object, parseOnlineOrderConfirmation } from "@provide/contracts";
import { createProtectedIntegrationWorker } from "./checkout-integration-fixture.js";
import { postgresOnlineRepository } from "./online-payments-database.js";
import { processOnlinePayment, type PaymentProvider } from "./online-payments.js";
import { CheckoutCreationRejected } from "./stripe-sandbox.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("creation rejection against real PostgreSQL", () => {
  it("closes confirmed failures, preserves uncertainty, leases and existing sessions", async () => {
    if (
      !databaseUrl ||
      !["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)
    )
      throw new Error("Explicit disposable loopback database required");
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    try {
      await admin.query("BEGIN");
      await admin.query(
        await readFile(
          new URL("../../../supabase/tests/fixtures/storefront.fixture.inc", import.meta.url),
          "utf8",
        ),
      );
      await admin.query(
        "insert into public.restaurant_feature_flags(restaurant_id,feature_key,enabled) values('f2000000-0000-0000-0000-000000000001','payment.online',true)",
      );
      await admin.query(
        "insert into private.restaurant_test_payment_accounts(restaurant_id,platform_account_id,merchant_account_id,enabled,expires_at,reason) values('f2000000-0000-0000-0000-000000000001','acct_synthetic','acct_restaurantA',true,clock_timestamp()+interval '1 day','Synthetic creation-rejection integration')",
      );
      await admin.query("COMMIT");
      const access = await admin.query<{ anon: boolean; authenticated: boolean; service: boolean }>(
        "select has_function_privilege('anon','private.reject_online_payment_creation(uuid,uuid,text,text,text)','execute') as anon,has_function_privilege('authenticated','private.reject_online_payment_creation(uuid,uuid,text,text,text)','execute') as authenticated,has_function_privilege('service_role','private.reject_online_payment_creation(uuid,uuid,text,text,text)','execute') as service",
      );
      expect(access.rows[0]).toEqual({ anon: false, authenticated: false, service: true });
      const config = {
        key: "sk_test_synthetic",
        account: "acct_synthetic",
        webhookSecret: "whsec_synthetic",
        returnOrigin: "https://store.example.test",
      };
      const env = {
        APP_ENV: "test",
        HYPERDRIVE: { connectionString: databaseUrl },
        HYPERDRIVE_CACHE_DISABLED: "true",
        CHECKOUT_WRITE_ENABLED: "true",
        CHECKOUT_PRIVACY_NOTICE_VERSION: "preview-v1",
        CHECKOUT_RETENTION_DAYS: "30",
        ORDER_STATUS_READ_ENABLED: "true",
        ORDER_STATUS_TOKEN_SECRET: "synthetic-integration-status-secret-at-least-32-bytes",
        ONLINE_PAYMENT_ENABLED: "true",
        ONLINE_PAYMENT_PROCESSING_ENABLED: "true",
        STRIPE_TEST_SECRET_KEY: config.key,
        STRIPE_TEST_ACCOUNT_ID: config.account,
        STRIPE_TEST_WEBHOOK_SECRET: config.webhookSecret,
        PAYMENT_RETURN_ORIGIN: config.returnOrigin,
        PAYMENT_ACCESS_SECRET: "synthetic-payment-secret-at-least-32-bytes",
      };
      const worker = createProtectedIntegrationWorker();
      const create = async (label: string) => {
        const date = new Date(Date.now() + 6 * 3600000);
        date.setUTCMinutes(0, 0, 0);
        const response = await worker.fetch(
          new Request(
            "https://api.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte/online-orders",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                menuId: "f4000000-0000-0000-0000-000000000001",
                menuVersionId: "f5000000-0000-0000-0000-000000000001",
                requestedFor: date.toISOString(),
                lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 1 }],
                submissionKey: "creation-rejection-" + label,
                customer: {
                  contactName: "Synthetic Rejection",
                  phoneE164: "+999100000041",
                  email: "synthetic@example.invalid",
                },
                privacyNoticeVersion: "preview-v1",
                fulfillmentType: "pickup",
              }),
            },
          ),
          env,
        );
        expect(response.status).toBe(201);
        const parsed = parseOnlineOrderConfirmation(object(await response.json())?.data);
        if (!parsed) throw new Error("Invalid confirmation");
        return parsed.orderId;
      };
      const read = (id: string) => postgresOnlineRepository.read(databaseUrl, config.account, id);
      const expire = vi.fn(),
        refund = vi.fn();
      const rejectedProvider: PaymentProvider = {
        session: vi.fn<PaymentProvider["session"]>((_config, job) =>
          Promise.reject(
            new CheckoutCreationRejected("req_" + job.id.replaceAll("-", ""), "a".repeat(64)),
          ),
        ),
        expire,
        refund,
      };
      for (const close of [null, "rejected"]) {
        const id = await create(close ?? "default");
        if (close)
          await admin.query(
            "update public.online_payment_jobs set close_requested=$2 where order_id=$1",
            [id, close],
          );
        await processOnlinePayment(
          databaseUrl,
          config,
          postgresOnlineRepository,
          rejectedProvider,
          id,
        );
        expect(await read(id)).toMatchObject({
          order_status: close ?? "cancelled",
          payment_status: "failed",
          provider_terminal: true,
          last_error: null,
          session_id: null,
          intent_id: null,
        });
        const row = (
          await admin.query<{
            next_at: string | null;
            captured_amount_minor: string;
            refunded_amount_minor: string;
          }>(
            "select j.next_at,p.captured_amount_minor,p.refunded_amount_minor from public.online_payment_jobs j join public.order_payments p on p.order_id=j.order_id where j.order_id=$1",
            [id],
          )
        ).rows[0];
        if (!row) throw new Error("Missing payment row");
        expect(row.next_at).toBeNull();
        expect(Number(row.captured_amount_minor)).toBe(0);
        expect(Number(row.refunded_amount_minor)).toBe(0);
        await processOnlinePayment(
          databaseUrl,
          config,
          postgresOnlineRepository,
          rejectedProvider,
          id,
        );
        expect(
          Number(
            (
              await admin.query<{ count: string }>(
                "select count(*) from public.order_status_events where order_id=$1",
                [id],
              )
            ).rows[0]?.count,
          ),
        ).toBe(2);
      }
      const uncertain = await create("uncertain");
      await processOnlinePayment(
        databaseUrl,
        config,
        postgresOnlineRepository,
        { ...rejectedProvider, session: vi.fn().mockRejectedValue(new Error("response lost")) },
        uncertain,
      );
      expect(await read(uncertain)).toMatchObject({
        order_status: "submitted",
        payment_status: "created",
        provider_terminal: false,
        last_error: "provider_unavailable",
      });
      const protectedId = await create("guarded"),
        lease = crypto.randomUUID();
      const claimed = await postgresOnlineRepository.claim(
        databaseUrl,
        config.account,
        protectedId,
        lease,
      );
      if (!claimed) throw new Error("Missing claim");
      await expect(
        postgresOnlineRepository.rejectCreation(
          databaseUrl,
          claimed.id,
          crypto.randomUUID(),
          "req_wrongLease",
          "b".repeat(64),
        ),
      ).rejects.toThrow();
      await expect(
        postgresOnlineRepository.rejectCreation(
          databaseUrl,
          claimed.id,
          lease,
          "req_wrongMode",
          "b".repeat(64),
          "live",
        ),
      ).rejects.toThrow();
      expect(await read(protectedId)).toMatchObject({
        order_status: "submitted",
        payment_status: "created",
      });
      await postgresOnlineRepository.bind(
        databaseUrl,
        claimed.id,
        lease,
        "cs_test_existingSynthetic",
      );
      await expect(
        postgresOnlineRepository.rejectCreation(
          databaseUrl,
          claimed.id,
          lease,
          "req_existing",
          "b".repeat(64),
        ),
      ).rejects.toThrow();
      expect(await read(protectedId)).toMatchObject({
        order_status: "submitted",
        payment_status: "pending_customer",
        session_id: "cs_test_existingSynthetic",
        provider_terminal: false,
      });
      expect(refund).not.toHaveBeenCalled();
      expect(expire).not.toHaveBeenCalled();
      console.log(
        "Creation rejection: conclusive failures closed once; uncertainty, wrong lease, wrong mode and existing checkout protected; provider writes=0 PASS",
      );
    } finally {
      await admin.query("ROLLBACK").catch(() => undefined);
      await admin.end();
    }
  }, 60000);
});
