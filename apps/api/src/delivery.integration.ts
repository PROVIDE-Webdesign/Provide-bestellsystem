import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import type { Client } from "pg";
import { expect } from "vitest";
import { parseDeliveryQuote, parseGuestDeliveryOrderConfirmation } from "@provide/contracts";
import type { createApiWorker } from "./index.js";

function envelopeData(value: unknown): unknown {
  return value !== null && typeof value === "object" && "data" in value ? value.data : undefined;
}

export async function verifyDeliveryIntegration(
  admin: Client,
  worker: ReturnType<typeof createApiWorker>,
  baseEnv: Parameters<ReturnType<typeof createApiWorker>["fetch"]>[1],
) {
  const env = { ...baseEnv, DELIVERY_ORDERING_ENABLED: "true" };
  await admin.query(
    "update public.restaurants set status='active' where id='f2000000-0000-0000-0000-000000000001'",
  );
  await admin.query(
    "update public.restaurant_feature_flags set enabled=true where restaurant_id='f2000000-0000-0000-0000-000000000001' and feature_key='ordering.accept_orders'",
  );
  await admin.query(
    await readFile(
      new URL("../../../supabase/tests/fixtures/delivery.fixture.inc", import.meta.url),
      "utf8",
    ),
  );
  const scope = [
    "f1000000-0000-0000-0000-000000000001",
    "aal2",
    "f2000000-0000-0000-0000-000000000001",
    "f3000000-0000-0000-0000-000000000001",
  ];
  const publish = async (fee: number) => {
    const p = await admin.query<{ id: string }>(
      "select private.create_delivery_policy($1,$2,$3,$4,$5::jsonb) as id",
      [
        ...scope,
        JSON.stringify([{ postalCodes: ["52062"], minimumAmountMinor: 2500, feeAmountMinor: fee }]),
      ],
    );
    await admin.query("select private.publish_delivery_policy($1,$2,$3,$4,$5)", [
      ...scope,
      p.rows[0]!.id,
    ]);
  };
  await publish(350);
  const base = "https://api.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte";
  const post = (resource: string, body: unknown) =>
    worker.fetch(
      new Request(`${base}/${resource}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
    );
  const requestedFor = new Date(Date.now() + 4 * 60 * 60 * 1000);
  requestedFor.setUTCMinutes(0, 0, 0);
  const quoteRequest = {
    menuId: "f4000000-0000-0000-0000-000000000001",
    menuVersionId: "f5000000-0000-0000-0000-000000000001",
    requestedFor: requestedFor.toISOString(),
    lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 2 }],
    postalCode: "52062",
  };
  const quoteResponse = await post("delivery-quote", quoteRequest);
  expect(quoteResponse.status).toBe(200);
  const quote = parseDeliveryQuote(envelopeData(await quoteResponse.json()));
  expect(quote?.totalAmountMinor).toBe(2850);
  const { postalCode, ...request } = quoteRequest;
  const command = {
    ...request,
    submissionKey: "integration-delivery-1",
    customer: { contactName: "Synthetic Delivery", phoneE164: "+999100000031", email: null },
    delivery: {
      addressLine1: "Synthetic Lieferweg 10",
      addressLine2: null,
      postalCode,
      city: "Aachen",
      countryCode: "DE",
    },
    privacyNoticeVersion: "preview-v1",
    expectedQuote: quote,
  };
  // Two distinct orders race for one free delivery slot through real independent SQL connections.
  const raced = await Promise.all([
    post("delivery-orders", command),
    post("delivery-orders", { ...command, submissionKey: "integration-delivery-2" }),
  ]);
  expect(raced.map((r) => r.status).sort()).toEqual([201, 409]);
  const winnerIndex = raced.findIndex((r) => r.status === 201);
  const confirmation = parseGuestDeliveryOrderConfirmation(
    envelopeData(await raced[winnerIndex]!.json()),
  );
  if (!confirmation) throw new Error("Invalid delivery integration confirmation");
  const winner = {
    ...command,
    submissionKey: winnerIndex === 0 ? "integration-delivery-1" : "integration-delivery-2",
  };
  const dashboard =
    "https://api.test/v1/dashboard/restaurants/f2000000-0000-0000-0000-000000000001/locations/f3000000-0000-0000-0000-000000000001/orders";
  const list = await worker.fetch(
    new Request(`${dashboard}?fulfillmentType=delivery`, {
      headers: { authorization: "Bearer header.payload.signature" },
    }),
    env,
  );
  expect(list.status).toBe(200);
  const listData: { data: { orders: unknown[] } } = await list.json();
  expect(listData.data.orders).toHaveLength(1);
  const detail = await worker.fetch(
    new Request(`${dashboard}/${confirmation.orderId}`, {
      headers: { authorization: "Bearer header.payload.signature" },
    }),
    env,
  );
  await expect(detail.json()).resolves.toMatchObject({
    data: {
      fulfillmentType: "delivery",
      deliveryFeeAmountMinor: 350,
      delivery: { addressLine1: "Synthetic Lieferweg 10" },
    },
  });
  await publish(450);
  expect((await post("delivery-orders", winner)).status).toBe(201);
  expect(
    (
      await post("delivery-orders", {
        ...winner,
        delivery: { ...winner.delivery, addressLine1: "Different address" },
      })
    ).status,
  ).toBe(409);
  const status = await post("order-status", {
    orderId: confirmation.orderId,
    statusAccessToken: confirmation.statusAccessToken,
  });
  const statusText = await status.text();
  expect(status.status).toBe(200);
  expect(statusText).not.toContain("Lieferweg");
  expect(statusText).toContain("delivery");
  for (const [from, to] of [
    ["submitted", "accepted"],
    ["accepted", "preparing"],
    ["preparing", "ready"],
  ]) {
    const response = await worker.fetch(
      new Request(`${dashboard}/${confirmation.orderId}/status`, {
        method: "POST",
        headers: {
          authorization: "Bearer header.payload.signature",
          "content-type": "application/json",
        },
        body: JSON.stringify({ expectedStatus: from, targetStatus: to }),
      }),
      env,
    );
    expect(response.status).toBe(200);
  }
  const pending: Promise<unknown>[] = [];
  worker.scheduled({} as ScheduledController, env, {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  } as unknown as ExecutionContext);
  await Promise.all(pending);
  const deliveryState = await admin.query<{ status: string }>(
    "select status from public.notification_deliveries where order_id=$1 and target_status='ready'",
    [confirmation.orderId],
  );
  expect(deliveryState.rows[0]?.status).toBe("sent");
  const payments = await admin.query<{ amount_due_minor: string }>(
    "select amount_due_minor from public.order_payments where order_id=$1",
    [confirmation.orderId],
  );
  expect(payments.rows[0]?.amount_due_minor).toBe("2850");
  const done = await worker.fetch(
    new Request(`${dashboard}/${confirmation.orderId}/status`, {
      method: "POST",
      headers: {
        authorization: "Bearer header.payload.signature",
        "content-type": "application/json",
      },
      body: JSON.stringify({ expectedStatus: "ready", targetStatus: "completed" }),
    }),
    env,
  );
  expect(done.status).toBe(200);
  await admin.query(
    "select private.purge_expired_guest_checkout_data(now()+interval '31 days',500)",
  );
  const pii = await admin.query<{ phone_e164: string | null; address_line_1: string | null }>(
    "select phone_e164,address_line_1 from public.order_delivery_details where order_id=$1",
    [confirmation.orderId],
  );
  expect(pii.rows[0]).toEqual({ phone_e164: null, address_line_1: null });
}
