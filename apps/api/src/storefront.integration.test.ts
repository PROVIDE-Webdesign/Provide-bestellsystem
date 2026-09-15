import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";
import fixture from "../../../fixtures/storefront-catalog.json" with { type: "json" };
import { parseGuestPickupOrderConfirmation } from "@provide/contracts";
import { createApiWorker } from "./index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
// A fresh, migrated disposable database is mandatory; the shared fixture commits synthetic data.
describe.skipIf(!databaseUrl)("storefront HTTP to real PostgreSQL", () => {
  it("reads the real fixture and reflects scope, item, ordering and go-live changes", async () => {
    if (
      !databaseUrl ||
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)
    )
      throw new Error("Integration tests require an explicit loopback test database");
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    const worker = createApiWorker(undefined, { error: vi.fn() });
    const env = {
      APP_ENV: "test",
      HYPERDRIVE: { connectionString: databaseUrl },
      HYPERDRIVE_CACHE_DISABLED: "true",
      CHECKOUT_WRITE_ENABLED: "true",
      CHECKOUT_PRIVACY_NOTICE_VERSION: "preview-v1",
      CHECKOUT_RETENTION_DAYS: "30",
      ORDER_STATUS_READ_ENABLED: "true",
      ORDER_STATUS_TOKEN_SECRET: "synthetic-integration-status-secret-at-least-32-bytes",
    };
    const base = "https://api.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte";
    try {
      await admin.query("BEGIN");
      const fixtureSql: string = await readFile(
        new URL("../../../supabase/tests/fixtures/storefront.fixture.inc", import.meta.url),
        "utf8",
      );
      await admin.query(fixtureSql);
      await admin.query("COMMIT");
      const read = async (path: string) => worker.fetch(new Request(path), env);
      const catalog = await read(`${base}/catalog`);
      expect(catalog.status).toBe(200);
      await expect(catalog.json()).resolves.toMatchObject({ data: fixture });
      const { rows } = await admin.query<{ requested_for: string }>(
        "select to_char((date_trunc('hour',now()) + interval '2 hours') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as requested_for",
      );
      const query = new URLSearchParams({
        fulfillmentType: "pickup",
        requestedFor: rows[0]!.requested_for,
        itemCount: "2",
      });
      await expect(
        (await read(`${base}/availability?${query.toString()}`)).json(),
      ).resolves.toMatchObject({
        data: { status: "available" },
      });
      const order = await worker.fetch(
        new Request(`${base}/orders`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            menuId: "f4000000-0000-0000-0000-000000000001",
            menuVersionId: "f5000000-0000-0000-0000-000000000001",
            requestedFor: rows[0]!.requested_for,
            lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 2 }],
            submissionKey: "integration-pickup-order-0001",
            customer: {
              contactName: "Synthetic Integration Guest",
              phoneE164: "+999100000001",
              email: null,
            },
            privacyNoticeVersion: "preview-v1",
          }),
        }),
        env,
      );
      expect(order.status).toBe(201);
      const orderEnvelope: unknown = await order.json();
      const orderData =
        orderEnvelope !== null && typeof orderEnvelope === "object" && !Array.isArray(orderEnvelope)
          ? (orderEnvelope as Record<string, unknown>).data
          : undefined;
      const orderPayload = parseGuestPickupOrderConfirmation(orderData);
      if (!orderPayload) throw new Error("Integration checkout confirmation is invalid");
      expect(orderPayload).toMatchObject({
        status: "submitted",
        fulfillmentType: "pickup",
        paymentCollectionMode: "on_fulfillment",
        totalAmountMinor: 2500,
      });
      const statusRequest = (token = orderPayload.statusAccessToken) =>
        worker.fetch(
          new Request(`${base}/order-status`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ orderId: orderPayload.orderId, statusAccessToken: token }),
          }),
          env,
        );
      await expect((await statusRequest()).json()).resolves.toMatchObject({
        data: { status: "submitted", totalAmountMinor: 2500 },
      });
      expect((await statusRequest("a".repeat(43))).status).toBe(404);
      await admin.query("BEGIN");
      await admin.query("SET LOCAL ROLE service_role");
      await admin.query(
        "select private.transition_order_status($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text)",
        [
          "f2000000-0000-0000-0000-000000000001",
          "f3000000-0000-0000-0000-000000000001",
          orderPayload.orderId,
          "accepted",
          "f1000000-0000-0000-0000-000000000001",
          "aal2",
        ],
      );
      await admin.query("COMMIT");
      await expect((await statusRequest()).json()).resolves.toMatchObject({
        data: { status: "accepted" },
      });
      const persisted = await admin.query<{ count: string }>(
        "select count(*) from public.orders where submission_key='integration-pickup-order-0001'",
      );
      expect(persisted.rows[0]?.count).toBe("1");
      expect(
        (
          await read(
            base.replace("storefront-restaurant-a", "storefront-restaurant-b") + "/catalog",
          )
        ).status,
      ).toBe(404);
      await admin.query(
        "update public.restaurant_feature_flags set enabled=false where restaurant_id='f2000000-0000-0000-0000-000000000001' and feature_key='ordering.accept_orders'",
      );
      await expect(
        (await read(`${base}/availability?${query.toString()}`)).json(),
      ).resolves.toMatchObject({
        data: { status: "unavailable" },
      });
      expect((await read(`${base}/catalog`)).status).toBe(200);
      await admin.query(
        "update public.restaurants set status='suspended' where id='f2000000-0000-0000-0000-000000000001'",
      );
      expect((await read(`${base}/catalog`)).status).toBe(404);
      expect((await read(`${base}/availability?${query.toString()}`)).status).toBe(404);
      await expect((await statusRequest()).json()).resolves.toMatchObject({
        data: { status: "accepted" },
      });
      const claims = await admin.query<{ count: string }>(
        "select count(*) from public.ordering_capacity_claims where restaurant_id='f2000000-0000-0000-0000-000000000001'",
      );
      expect(claims.rows[0]?.count).toBe("1");
    } finally {
      await admin.end();
    }
  }, 30000);
});
