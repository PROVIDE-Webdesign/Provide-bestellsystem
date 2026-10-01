import { expect } from "vitest";
import type { Client } from "pg";
import { parseGuestPickupOrderConfirmation } from "@provide/contracts";
import { createApiWorker } from "./index.js";
import { postgresCheckoutWriter } from "./checkout-database.js";

type Env = Parameters<ReturnType<typeof createApiWorker>["fetch"]>[1];

export async function verifyOrderNumberIntegration(admin: Client, env: Env) {
  const worker = createApiWorker(
    undefined,
    undefined,
    undefined,
    {
      async submit(...args) {
        try {
          return await postgresCheckoutWriter.submit(...args);
        } catch (error) {
          console.error("Number checkout database failure", error);
          throw error;
        }
      },
    },
    undefined,
    {
      verify: () =>
        Promise.resolve({ userId: "f1000000-0000-0000-0000-000000000001", aal: "aal2" }),
    },
  );
  const base = "https://api.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte";
  const time = await admin.query<{ requested_for: string }>(
    "select to_char((date_trunc('hour',now())+interval '8 hours') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as requested_for",
  );
  const request = {
    menuId: "f4000000-0000-0000-0000-000000000001",
    menuVersionId: "f5000000-0000-0000-0000-000000000001",
    requestedFor: time.rows[0]!.requested_for,
    lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 1 }],
    customer: {
      contactName: "Synthetic Number",
      phoneE164: "+999100000041",
      email: "synthetic@example.invalid",
    },
    privacyNoticeVersion: "preview-v1",
  };
  const post = (resource: string, body: unknown) =>
    worker.fetch(
      new Request(`${base}/${resource}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
    );
  const submit = async (key: string) => {
    const response = await post("orders", { ...request, submissionKey: key });
    expect(
      response.status,
      response.status === 201 ? undefined : await response.clone().text(),
    ).toBe(201);
    const envelope: { data?: unknown } = await response.json();
    const confirmation = parseGuestPickupOrderConfirmation(envelope.data)!;
    expect(confirmation.orderNumber).toMatch(/^BS-[0-9]{8,19}$/);
    return confirmation;
  };
  // Independent API database connections race on an identical submission and a distinct order.
  const [first, repeat, second] = await Promise.all([
    submit("number-api-race-001"),
    submit("number-api-race-001"),
    submit("number-api-race-002"),
  ]);
  expect(repeat.orderId).toBe(first.orderId);
  expect(repeat.orderNumber).toBe(first.orderNumber);
  expect(second.orderId).not.toBe(first.orderId);
  expect(second.orderNumber).not.toBe(first.orderNumber);
  const records = await admin.query<{ id: string; number: string }>(
    "select id,private.format_order_number(order_number) as number from public.orders where submission_key in ('number-api-race-001','number-api-race-002')",
  );
  expect(records.rows).toHaveLength(2);
  expect(records.rows).toContainEqual({ id: first.orderId, number: first.orderNumber });
  const status = await post("order-status", {
    orderId: first.orderId,
    statusAccessToken: first.statusAccessToken,
  });
  expect(status.status).toBe(200);
  await expect(status.json()).resolves.toMatchObject({ data: { orderNumber: first.orderNumber } });
  expect(
    (
      await post("order-status", {
        orderId: first.orderNumber,
        statusAccessToken: first.statusAccessToken,
      })
    ).status,
  ).toBe(400);
  expect(
    (await post("order-status", { orderId: first.orderId, statusAccessToken: "b".repeat(43) }))
      .status,
  ).toBe(404);
  const dashboard =
    "https://api.test/v1/dashboard/restaurants/f2000000-0000-0000-000000000001/locations/f3000000-0000-0000-000000000001/orders";
  const search = await worker.fetch(
    new Request(`${dashboard}?orderNumber=${first.orderNumber}`, {
      headers: { authorization: "Bearer header.payload.signature" },
    }),
    env,
  );
  expect(search.status).toBe(200);
  const found: { data: { orders: { orderId: string; orderNumber: string }[] } } =
    await search.json();
  expect(found.data.orders).toHaveLength(1);
  expect(found.data.orders[0]).toMatchObject({
    orderId: first.orderId,
    orderNumber: first.orderNumber,
  });
  expect(found.data.orders[0]).not.toHaveProperty("contactName");
  const mismatch = await worker.fetch(
    new Request(`${dashboard}?orderNumber=${first.orderNumber}&status=accepted`, {
      headers: { authorization: "Bearer header.payload.signature" },
    }),
    env,
  );
  await expect(mismatch.json()).resolves.toMatchObject({ data: { orders: [] } });
}
