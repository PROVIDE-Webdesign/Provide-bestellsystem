import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { dispatchDomainWebhooks } from "./domain-webhooks.js";

const database = process.env.TEST_DATABASE_URL;
const restaurant = "f2000000-0000-0000-0000-000000000001";
const location = "f3000000-0000-0000-0000-000000000001";

describe.skipIf(!database)("domain webhook worker / database / receiver", () => {
  it("recovers a lost response without duplicating the receiver effect", async () => {
    if (!database || new URL(database).hostname !== "127.0.0.1")
      throw new Error("Explicit disposable loopback database required");
    const client = new Client({ connectionString: database });
    await client.connect();
    const accepted = new Set<string>();
    const received: string[] = [];
    const secret = "synthetic-domain-integration-secret-32-bytes";
    const id = randomUUID(),
      objectId = randomUUID(),
      version = randomUUID();
    const cutoff = new Date().toISOString();
    const server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        body += chunk;
      });
      req.on("end", () => {
        const signature = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(
          String(req.headers["x-provide-signature"]),
        );
        const eventId = req.headers["idempotency-key"];
        if (
          !signature ||
          eventId !== id ||
          createHmac("sha256", secret)
            .update(signature[1]! + ".")
            .update(body)
            .digest("hex") !== signature[2]
        ) {
          res.writeHead(400).end();
          return;
        }
        received.push(eventId);
        const duplicate = accepted.has(eventId);
        accepted.add(eventId);
        if (!duplicate) req.socket.destroy();
        else res.writeHead(204).end();
      });
    });
    server.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing isolated receiver");
      const actual = `http://127.0.0.1:${address.port}/events`;
      await client.query(
        `insert into public.outbox_events(id,restaurant_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
         values($1,$2,'menu',$3,'menu.version.published',jsonb_build_object('location_id',$4::uuid,'menu_version_id',$5::uuid,'effective_at',$6::timestamptz),$7)`,
        [id, restaurant, objectId, location, version, cutoff, `isolated-webhook:${id}`],
      );
      const env = {
        HYPERDRIVE: { connectionString: database },
        HYPERDRIVE_CACHE_DISABLED: "true",
        DOMAIN_WEBHOOK_ENABLED: "true",
        DOMAIN_WEBHOOK_URL: "https://receiver.invalid/events",
        DOMAIN_WEBHOOK_SIGNING_SECRET: secret,
        DOMAIN_WEBHOOK_RESTAURANT_ID: restaurant,
        DOMAIN_WEBHOOK_ACTIVE_SINCE: cutoff,
      };
      const fetcher: typeof fetch = (input, options) => {
        if (!(input instanceof URL) || input.href !== env.DOMAIN_WEBHOOK_URL)
          throw new Error("Unexpected provider target");
        return fetch(actual, options);
      };
      const logger = { error: () => undefined };
      const run = () => dispatchDomainWebhooks(env, logger, undefined, fetcher);
      const result = async () =>
        (
          await client.query<{ status: string; last_error: string | null; attempt_count: number }>(
            "select status,last_error,attempt_count from public.outbox_events where id=$1",
            [id],
          )
        ).rows[0];

      await run();
      expect(await result()).toEqual({
        status: "retry",
        last_error: "confirmation_unknown",
        attempt_count: 1,
      });
      await run();
      expect(received).toEqual([id]);
      await client.query(
        "update public.outbox_events set available_at=statement_timestamp() where id=$1",
        [id],
      );
      await run();
      expect(await result()).toEqual({ status: "published", last_error: null, attempt_count: 2 });
      expect(received).toEqual([id, id]);
      expect([...accepted]).toEqual([id]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await client.end();
    }
  });
});
