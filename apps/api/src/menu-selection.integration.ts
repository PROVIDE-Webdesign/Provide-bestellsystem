import type { Client } from "pg";
import { expect } from "vitest";
import configuration from "../../../fixtures/menu-configuration.json" with { type: "json" };
import {
  parseCartQuote,
  parseGuestPickupOrderConfirmation,
  parseGuestDeliveryOrderConfirmation,
  parseOnlineOrderConfirmation,
} from "@provide/contracts";
import { createApiWorker } from "./index.js";
type Env = Parameters<ReturnType<typeof createApiWorker>["fetch"]>[1];
async function responseData(response: Response): Promise<unknown> {
  const value: unknown = await response.json();
  if (value === null || typeof value !== "object" || !("data" in value))
    throw new Error("Missing response envelope");
  return value.data;
}
export async function verifyMenuSelectionIntegration(admin: Client, baseEnv: Env) {
  const restaurant = "f2000000-0000-0000-0000-000000000001",
    location = "f3000000-0000-0000-0000-000000000001",
    menu = "f4000000-0000-0000-0000-000000000001",
    item = "f6000000-0000-0000-0000-000000000001",
    owner = "f1000000-0000-0000-0000-000000000001";
  const oldVersion = "f5000000-0000-0000-0000-000000000001";
  const { rows } = await admin.query<{ id: string }>(
    "select private.create_menu_draft($1,$2,$3,$4,'aal2') as id",
    [restaurant, menu, oldVersion, owner],
  );
  const version = rows[0]!.id;
  await admin.query("select private.set_menu_item_configuration($1,$2,$3,$4,$5,'aal2',0,$6)", [
    restaurant,
    menu,
    version,
    item,
    owner,
    configuration,
  ]);
  await admin.query(
    "select private.publish_menu_version($1,$2,$3,$4,statement_timestamp(),$5,'aal2')",
    [restaurant, location, menu, version, owner],
  );
  const env = {
    ...baseEnv,
    CART_QUOTE_ENABLED: "true",
    DELIVERY_ORDERING_ENABLED: "true",
    ONLINE_PAYMENT_ENABLED: "true",
    ONLINE_PAYMENT_PROCESSING_ENABLED: "true",
    STRIPE_TEST_SECRET_KEY: "sk_test_synthetic",
    STRIPE_TEST_ACCOUNT_ID: "acct_synthetic",
    STRIPE_TEST_WEBHOOK_SECRET: "whsec_synthetic",
    PAYMENT_ACCESS_SECRET: "synthetic-selection-payment-secret-at-least-32-bytes",
    PAYMENT_RETURN_ORIGIN: "https://store.example.test",
  };
  const worker = createApiWorker();
  const base = "https://api.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte";
  const post = (resource: string, body: unknown) =>
    worker.fetch(
      new Request(base + "/" + resource, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
    );
  const when = (hours: number) => {
    const d = new Date(Date.now() + hours * 3600000);
    d.setUTCMinutes(0, 0, 0);
    return d.toISOString();
  };
  const lines = [
    {
      menuItemId: item,
      quantity: 2,
      variantId: configuration.variants[1]!.id,
      optionIds: [configuration.optionGroups[0]!.options[1]!.id],
    },
  ];
  const selection = { menuId: menu, menuVersionId: oldVersion, requestedFor: when(14), lines };
  const reviewResponse = await post("cart-quote", { ...selection, fulfillmentType: "pickup" });
  expect(reviewResponse.status).toBe(200);
  const review = parseCartQuote(await responseData(reviewResponse));
  expect(review).toMatchObject({
    status: "changed",
    currentMenuVersionId: version,
    subtotalAmountMinor: 3000,
    lines: [
      {
        unitPriceAmountMinor: 1500,
        selectionSnapshot: { variant: { name: "Large" }, taxAmountMinor: 196 },
      },
    ],
  });
  const customer = {
    contactName: "Synthetic",
    phoneE164: "+999100000001",
    email: "synthetic@example.invalid",
  };
  const order = {
    ...selection,
    menuVersionId: version,
    customer,
    privacyNoticeVersion: "preview-v1",
    submissionKey: "selection-pickup-integration-0001",
  };
  expect((await post("orders", { ...order, menuVersionId: oldVersion })).status).toBe(409);
  const response = await post("orders", order);
  expect(response.status).toBe(201);
  const pickup = parseGuestPickupOrderConfirmation(await responseData(response))!;
  expect(pickup.totalAmountMinor).toBe(3000);
  const deliverySelection = {
    ...selection,
    menuVersionId: version,
    requestedFor: when(15),
    fulfillmentType: "delivery",
    postalCode: "52062",
  };
  const deliveryResponse = await post("cart-quote", deliverySelection);
  expect(deliveryResponse.status).toBe(200);
  const deliveryReview = parseCartQuote(await responseData(deliveryResponse));
  if (!deliveryReview || deliveryReview.status === "unavailable" || !deliveryReview.deliveryQuote)
    throw new Error("Missing configured delivery review");
  expect(deliveryReview.subtotalAmountMinor).toBe(3000);
  const deliveryOrder = {
    ...order,
    requestedFor: when(15),
    submissionKey: "selection-delivery-integration-0001",
    delivery: {
      addressLine1: "Synthetic street 1",
      addressLine2: null,
      postalCode: "52062",
      city: "Aachen",
      countryCode: "DE",
    },
    expectedQuote: deliveryReview.deliveryQuote,
  };
  const delivered = await post("delivery-orders", deliveryOrder);
  expect(delivered.status).toBe(201);
  const delivery = parseGuestDeliveryOrderConfirmation(await responseData(delivered))!;
  expect(delivery.totalAmountMinor).toBe(deliveryReview.deliveryQuote.totalAmountMinor);
  const onlineResponse = await post("online-orders", {
    ...order,
    requestedFor: when(16),
    submissionKey: "selection-online-integration-0001",
    fulfillmentType: "pickup",
  });
  expect(onlineResponse.status).toBe(201);
  const online = parseOnlineOrderConfirmation(await responseData(onlineResponse))!;
  expect(online.totalAmountMinor).toBe(3000);
  const payment = await admin.query<{ amount: number }>(
    "select (private.read_online_payment_job('acct_synthetic',$1)->>'amount')::integer as amount",
    [online.orderId],
  );
  expect(payment.rows[0]!.amount).toBe(3000);
  const onlineDeliveryResponse = await post("online-orders", {
    ...deliveryOrder,
    requestedFor: when(17),
    submissionKey: "selection-online-delivery-integration-0001",
    fulfillmentType: "delivery",
  });
  expect(onlineDeliveryResponse.status).toBe(201);
  const onlineDelivery = parseOnlineOrderConfirmation(await responseData(onlineDeliveryResponse))!;
  expect(onlineDelivery.totalAmountMinor).toBe(deliveryReview.deliveryQuote.totalAmountMinor);
  const deliveryPayment = await admin.query<{ amount: number }>(
    "select (private.read_online_payment_job('acct_synthetic',$1)->>'amount')::integer as amount",
    [onlineDelivery.orderId],
  );
  expect(deliveryPayment.rows[0]!.amount).toBe(deliveryReview.deliveryQuote.totalAmountMinor);
  const saved = await admin.query<{ selection_snapshot: unknown }>(
    "select selection_snapshot from public.order_lines where order_id=$1",
    [pickup.orderId],
  );
  expect(saved.rows[0]!.selection_snapshot).toMatchObject({
    variant: { name: "Large" },
    options: [{ name: "Extra B" }],
    taxAmountMinor: 196,
  });
  // A real concurrent publication holds the same lock as final checkout validation.
  const next = await admin.query<{ id: string }>(
    "select private.create_menu_draft($1,$2,$3,$4,'aal2') as id",
    [restaurant, menu, version, owner],
  );
  await admin.query("BEGIN");
  let committed = false;
  const { rows: backend } = await admin.query<{ pid: number }>("select pg_backend_pid() as pid");
  await admin.query(
    "select pg_advisory_xact_lock(hashtextextended('menu-publication:'||$1::text||':'||$2::text||':'||$3::text,0))",
    [restaurant, location, menu],
  );
  const pending = post("orders", {
    ...order,
    requestedFor: when(18),
    submissionKey: "selection-concurrent-publication-0001",
  });
  try {
    let blocked = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const check = await admin.query<{ blocked: boolean }>(
        "select exists(select 1 from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid))) as blocked",
        [backend[0]!.pid],
      );
      if (check.rows[0]!.blocked) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(blocked).toBe(true);
    // Publish after the checkout began waiting: its original statement timestamp is now stale.
    await admin.query(
      "select private.publish_menu_version($1,$2,$3,$4,statement_timestamp(),$5,'aal2')",
      [restaurant, location, menu, next.rows[0]!.id, owner],
    );
    await admin.query("COMMIT");
    committed = true;
    expect((await pending).status).toBe(409);
    const absent = await admin.query<{ count: string }>(
      "select count(*) from public.orders where submission_key='selection-concurrent-publication-0001'",
    );
    expect(absent.rows[0]!.count).toBe("0");
  } finally {
    if (!committed) await admin.query("ROLLBACK");
    await pending;
  }
  await admin.query(
    "select private.rollback_menu_version($1,$2,$3,$4,statement_timestamp(),$5,'aal2')",
    [restaurant, location, menu, oldVersion, owner],
  );
  const retry = await post("orders", order);
  expect(retry.status).toBe(201);
  expect(parseGuestPickupOrderConfirmation(await responseData(retry))?.orderId).toBe(
    pickup.orderId,
  );
  const after = await admin.query<{ selection_snapshot: unknown }>(
    "select selection_snapshot from public.order_lines where order_id=$1",
    [pickup.orderId],
  );
  expect(after.rows[0]!.selection_snapshot).toEqual(saved.rows[0]!.selection_snapshot);
}
