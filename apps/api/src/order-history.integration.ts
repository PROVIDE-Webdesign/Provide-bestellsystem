import type { Client } from "pg";
import { expect, vi } from "vitest";
import { parseOrderHistory, type HistoryQuery } from "@provide/contracts";
import { createApiWorker } from "./index.js";
export async function verifyHistoryIntegration(
  admin: Client,
  sourceEnv: Parameters<ReturnType<typeof createApiWorker>["fetch"]>[1],
) {
  const scope = {
    restaurantId: "f2000000-0000-0000-0000-000000000001",
    locationId: "f3000000-0000-0000-0000-000000000001",
  };
  const identity = { userId: "f1000000-0000-0000-0000-000000000002", aal: "aal2" as const };
  const logger = { error: vi.fn() },
    worker = createApiWorker(undefined, logger, undefined, undefined, undefined, {
      verify: () => Promise.resolve(identity),
    });
  const env = { ...sourceEnv, DASHBOARD_HISTORY_ENABLED: "true" };
  const base = `https://api.test/v1/dashboard/restaurants/${scope.restaurantId}/locations/${scope.locationId}/history`;
  const read = async (q: HistoryQuery = {}, status = 200, endpoint = base) => {
    const response = await worker.fetch(
      new Request(endpoint, {
        method: "POST",
        headers: {
          authorization: "Bearer header.payload.signature",
          "content-type": "application/json",
        },
        body: JSON.stringify(q),
      }),
      env,
    );
    expect(response.status, await response.clone().text()).toBe(status);
    if (status !== 200) return null;
    const envelope: { data?: unknown } = await response.json();
    const data = parseOrderHistory(envelope.data);
    expect(data).toBeDefined();
    return data!;
  };
  const first = (await read({ limit: 2 }))!;
  const expected = await admin.query<{
    currency: string;
    n: string;
    gross: string;
    captured: string;
    refunded: string;
  }>(
    `select o.currency_code as currency,count(*)::text as n,
    coalesce(sum(o.total_amount_minor) filter(where o.status='completed'),0)::text as gross,
    sum(p.captured_amount_minor)::text as captured,sum(p.refunded_amount_minor)::text as refunded
    from public.orders o join public.order_payments p on p.restaurant_id=o.restaurant_id and p.location_id=o.location_id and p.order_id=o.id
    where o.restaurant_id=$1 and o.location_id=$2 and o.created_at >= $3::date::timestamp at time zone $5 and o.created_at < ($4::date+1)::timestamp at time zone $5 group by o.currency_code`,
    [scope.restaurantId, scope.locationId, first.fromDate, first.toDate, first.timezone],
  );
  for (const row of expected.rows)
    expect(
      first.metrics.find((m) => m.period === "total" && m.currency === row.currency),
    ).toMatchObject({
      orderCount: Number(row.n),
      completedGrossMinor: Number(row.gross),
      capturedMinor: Number(row.captured),
      refundedMinor: Number(row.refunded),
    });
  const ids = first.orders.map((o) => o.orderId);
  let cursor = first.nextCursor;
  for (let page = 0; cursor && page < 50; page++) {
    const next = (await read({
      fromDate: first.fromDate,
      toDate: first.toDate,
      limit: 2,
      cursor,
    }))!;
    expect(next.metrics).toEqual(first.metrics);
    ids.push(...next.orders.map((o) => o.orderId));
    cursor = next.nextCursor;
  }
  expect(cursor).toBeNull();
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBe(expected.rows.reduce((n, row) => n + Number(row.n), 0));
  const selected = first.orders[0]!;
  const detail = (await read({ orderId: selected.orderId }))!;
  expect(detail.detail?.order.orderNumber).toBe(selected.orderNumber);
  expect(detail.detail?.order.allowedTransitions).toEqual([]);
  const events = await admin.query<{ n: string }>(
    "select count(*)::text as n from public.order_status_events where restaurant_id=$1 and location_id=$2 and order_id=$3",
    [scope.restaurantId, scope.locationId, selected.orderId],
  );
  expect(detail.detail?.events).toHaveLength(Number(events.rows[0]!.n));
  expect(
    (await read({ orderNumber: selected.orderNumber! }))?.orders.map((o) => o.orderId),
  ).toEqual([selected.orderId]);
  expect((await read({ customerName: "%_" }))?.orders).toEqual([]);
  await read({}, 403, base.replace(scope.locationId, "f3000000-0000-0000-0000-000000000002"));
  await admin.query(
    "update public.restaurant_memberships set status='suspended' where restaurant_id=$1 and user_id=$2",
    [scope.restaurantId, identity.userId],
  );
  try {
    await read({}, 403);
  } finally {
    await admin.query(
      "update public.restaurant_memberships set status='active' where restaurant_id=$1 and user_id=$2",
      [scope.restaurantId, identity.userId],
    );
  }
  await read({});
  const before = await admin.query<{ n: string }>(
    "select count(*)::text as n from private.guest_purge_runs",
  );
  const trigger = async () => {
    const pending: Promise<unknown>[] = [];
    worker.scheduled(
      {} as ScheduledController,
      {
        APP_ENV: "test",
        HYPERDRIVE: env.HYPERDRIVE!,
        HYPERDRIVE_CACHE_DISABLED: "true",
        GUEST_RETENTION_PURGE_ENABLED: "true",
      },
      {
        waitUntil(p: Promise<unknown>) {
          pending.push(p);
        },
      } as ExecutionContext,
    );
    await Promise.all(pending);
  };
  await Promise.all([trigger(), trigger()]);
  const after = await admin.query<{ n: string }>(
    "select count(*)::text as n from private.guest_purge_runs",
  );
  expect(Number(after.rows[0]!.n)).toBe(Number(before.rows[0]!.n) + 1);
  expect((await read({}))?.purge?.lastRunAt).toBeDefined();
  expect(logger.error).not.toHaveBeenCalled();
}
