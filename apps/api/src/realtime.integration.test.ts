import { SignJWT } from "jose";
import { Client } from "pg";
import {
  createClient,
  REALTIME_SUBSCRIBE_STATES,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  orderLiveTopic,
  parseOrderInvalidation,
  parseDashboardAcceptance,
} from "@provide/contracts";
import { createApiWorker } from "./index.js";
import { postgresDashboardOrdersReader } from "./dashboard-orders-database.js";
const url = process.env.TEST_REALTIME_URL,
  db = process.env.TEST_DATABASE_URL;
const restaurantId = "f2000000-0000-0000-0000-000000000001",
  locationId = "f3000000-0000-0000-0000-000000000001";
describe.skipIf(!url || !db)("isolated real private Realtime transport", () => {
  it("distributes PII-free committed hints, denies foreign/AAL/driver/send rights, and recovers with fresh authorized snapshots", async () => {
    const key = process.env.TEST_REALTIME_KEY,
      secret = process.env.TEST_REALTIME_JWT_SECRET;
    if (
      !url ||
      !db ||
      !key ||
      !secret ||
      [url, db].some((v) => !["localhost", "127.0.0.1", "[::1]"].includes(new URL(v).hostname))
    )
      throw Error("Explicit isolated loopback stack required");
    const admin = new Client({ connectionString: db });
    await admin.connect();
    const clients: SupabaseClient[] = [];
    const clientFor = async (suffix: string, aal = "aal2") => {
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({
        iss: `${url}/auth/v1`,
        aud: "authenticated",
        role: "authenticated",
        sub: `f1000000-0000-0000-0000-${suffix.padStart(12, "0")}`,
        aal,
        iat: now,
        exp: now + 180,
      })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .sign(new TextEncoder().encode(secret));
      const client = createClient(url, key, {
        accessToken: () => Promise.resolve(token),
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      await client.realtime.setAuth(token);
      clients.push(client);
      return client;
    };
    const join = (client: SupabaseClient, topic: string, events: unknown[]) => {
      const channel = client.channel(topic, {
        config: { private: true, broadcast: { ack: true } },
      });
      channel.on("broadcast", { event: "orders.invalidated.v1" }, (m) => events.push(m.payload));
      return {
        channel,
        ready: new Promise<"joined" | "denied">((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error("Private join timed out")), 12_000);
          channel.subscribe((state) => {
            if (state === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
              clearTimeout(timeout);
              resolve("joined");
            } else if (state === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
              clearTimeout(timeout);
              resolve("denied");
            }
          });
        }),
      };
    };
    const identity = { userId: "f1000000-0000-0000-0000-000000000001", aal: "aal2" as const };
    const read = async () => {
      const raw = await postgresDashboardOrdersReader.alerts!(db, identity, {
        restaurantId,
        locationId,
      });
      if (raw === null || typeof raw !== "object" || !("data" in raw))
        throw Error("No scoped inbox");
      const result = parseDashboardAcceptance(raw.data);
      if (!result) throw Error("Invalid inbox");
      return result;
    };
    try {
      const owner = await clientFor("1"),
        kitchen = await clientFor("3", "aal1"),
        ownerEvents: unknown[] = [],
        kitchenEvents: unknown[] = [];
      const first = join(owner, orderLiveTopic(restaurantId, locationId), ownerEvents),
        second = join(kitchen, orderLiveTopic(restaurantId, locationId), kitchenEvents);
      expect(await first.ready).toBe("joined");
      expect(await second.ready).toBe("joined");
      for (const [suffix, aal] of [
        ["5", "aal2"],
        ["1", "aal1"],
        ["4", "aal2"],
        ["6", "aal2"],
      ] as const) {
        const denied = join(
          await clientFor(suffix, aal),
          orderLiveTopic(restaurantId, locationId),
          [],
        );
        expect(await denied.ready).toBe("denied");
        await denied.channel.unsubscribe();
      }
      const worker = createApiWorker(undefined, undefined, undefined, undefined, undefined, {
        verify: () => Promise.resolve(identity),
      });
      const requestedFor = new Date(Date.now() + 36 * 3600000);
      requestedFor.setUTCMinutes(0, 0, 0);
      const command = {
        menuId: "f4000000-0000-0000-0000-000000000001",
        menuVersionId: "f5000000-0000-0000-0000-000000000001",
        requestedFor: requestedFor.toISOString(),
        lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 1 }],
        submissionKey: "realtime-synthetic-001",
        customer: {
          contactName: "Synthetic Realtime",
          phoneE164: "+999100000047",
          email: "synthetic@example.invalid",
        },
        privacyNoticeVersion: "preview-v1",
      };
      const env = {
        APP_ENV: "test",
        CHECKOUT_WRITE_ENABLED: "true",
        ORDER_STATUS_READ_ENABLED: "true",
        CHECKOUT_PRIVACY_NOTICE_VERSION: "preview-v1",
        CHECKOUT_RETENTION_DAYS: "30",
        ORDER_STATUS_TOKEN_SECRET: "synthetic-realtime-status-secret-at-least-32-bytes",
        HYPERDRIVE: { connectionString: db },
        HYPERDRIVE_CACHE_DISABLED: "true",
      };
      const response = await worker.fetch(
        new Request(
          "https://api.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte/orders",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(command),
          },
        ),
        env,
      );
      expect(
        response.status,
        response.status === 201 ? undefined : await response.clone().text(),
      ).toBe(201);
      const confirmation: unknown = await response.json();
      if (
        !confirmation ||
        typeof confirmation !== "object" ||
        !("data" in confirmation) ||
        !confirmation.data ||
        typeof confirmation.data !== "object" ||
        !("orderId" in confirmation.data) ||
        typeof confirmation.data.orderId !== "string"
      )
        throw Error("No order");
      const orderId = confirmation.data.orderId;
      await expect.poll(() => ownerEvents.length, { timeout: 10000 }).toBeGreaterThan(0);
      await expect.poll(() => kitchenEvents.length, { timeout: 10000 }).toBeGreaterThan(0);
      for (const event of [...ownerEvents, ...kitchenEvents])
        expect(parseOrderInvalidation(event)).toBeDefined();
      expect(JSON.stringify(ownerEvents)).not.toMatch(/Synthetic|phone|email|orderId|payment/);
      expect((await read()).orders.some((o) => o.orderId === orderId)).toBe(true);
      await admin.query(
        "update private.order_acceptance_alerts set started_at=now()-interval '10 minutes',deadline=now()-interval '5 minutes' where order_id=$1",
        [orderId],
      );
      const batches = await Promise.all([
        postgresDashboardOrdersReader.escalateAlerts!(db),
        postgresDashboardOrdersReader.escalateAlerts!(db),
      ]);
      expect(batches.reduce((a, b) => a + b, 0)).toBe(1);
      expect((await read()).orders.find((o) => o.orderId === orderId)?.escalatedAt).not.toBeNull();
      expect(
        (
          await admin.query<{ n: number }>(
            "select count(*)::integer as n from private.order_acceptance_events where order_id=$1 and kind='escalated'",
            [orderId],
          )
        ).rows[0]?.n,
      ).toBe(1);
      expect(
        await first.channel.send({
          type: "broadcast",
          event: "orders.invalidated.v1",
          payload: { schemaVersion: 1, eventId: orderId },
        }),
      ).not.toBe("ok");
      await kitchen.removeChannel(second.channel);
      ownerEvents.length = 0;
      await admin.query(
        "select private.transition_dashboard_order_with_reason($1,'aal2',$2,$3,$4,'submitted','accepted',null)",
        [identity.userId, restaurantId, locationId, orderId],
      );
      await expect.poll(() => ownerEvents.length, { timeout: 10000 }).toBeGreaterThan(0);
      const reconnect = join(kitchen, orderLiveTopic(restaurantId, locationId), []);
      expect(await reconnect.ready).toBe("joined");
      expect((await read()).orders.some((o) => o.orderId === orderId)).toBe(false);
      await admin.query(
        "update public.restaurant_memberships set status='suspended' where user_id=$1",
        [identity.userId],
      );
      const deniedSnapshot = await postgresDashboardOrdersReader.alerts!(db, identity, {
        restaurantId,
        locationId,
      });
      expect(deniedSnapshot).toEqual({ outcome: "forbidden" });
      await owner.removeChannel(first.channel);
      const revoked = join(owner, orderLiveTopic(restaurantId, locationId), []);
      expect(await revoked.ready).toBe("denied");
      await admin.query(
        "update public.restaurant_memberships set status='active' where user_id=$1",
        [identity.userId],
      );
    } finally {
      await Promise.all(clients.map((c) => c.removeAllChannels()));
      await admin.end();
    }
  }, 90_000);
});
