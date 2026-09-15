import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";
import fixture from "../../../fixtures/storefront-catalog.json" with { type: "json" };
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
    };
    const base = "https://api.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte";
    try {
      await admin.query("BEGIN");
      const fixtureSql: string = await readFile(
        new URL("../../../supabase/tests/fixtures/storefront.sql", import.meta.url),
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
      const claims = await admin.query<{ count: string }>(
        "select count(*) from public.ordering_capacity_claims where restaurant_id='f2000000-0000-0000-0000-000000000001'",
      );
      expect(claims.rows[0]?.count).toBe("0");
    } finally {
      await admin.end();
    }
  }, 30000);
});
