import type { Client } from "pg";
import { expect, vi } from "vitest";
import { object, parseOnlineOrderConfirmation, parseDeliveryQuote } from "@provide/contracts";
import { createApiWorker } from "./index.js";
import { postgresOnlineRepository } from "./online-payments-database.js";
import { processOnlinePayment } from "./online-payments.js";
import type { SandboxProvider, ProviderSession } from "./stripe-sandbox.js";

export async function verifyOnlineIntegration(
  admin: Client,
  baseEnv: Parameters<ReturnType<typeof createApiWorker>["fetch"]>[1],
) {
  await admin.query(
    "insert into public.restaurant_feature_flags(restaurant_id,feature_key,enabled) values('f2000000-0000-0000-0000-000000000001','payment.online',true)",
  );
  const sessions = new Map<string, ProviderSession>();
  let creates = 0;
  let failFirstCreate = true;
  let refundStatus: "failed" | "succeeded" = "failed";
  const provider: SandboxProvider = {
    session(_config, j) {
      let session = sessions.get(j.id);
      if (!session) {
        creates++;
        const suffix = j.id.replaceAll("-", "");
        session = {
          id: "cs_test_" + suffix,
          status: "open",
          paid: false,
          intent: null,
          url: "https://checkout.stripe.com/c/pay/cs_test_" + suffix,
        };
        sessions.set(j.id, session);
        if (failFirstCreate) {
          failFirstCreate = false;
          return Promise.reject(new Error("Synthetic response lost after provider creation"));
        }
      }
      return Promise.resolve({ ...session });
    },
    expire(_config, id) {
      const s = [...sessions.values()].find((s) => s.id === id);
      if (!s) throw new Error("Unknown synthetic session");
      s.status = "expired";
      s.url = null;
      return Promise.resolve();
    },
    refund(_config, _intent, id, refundId, _amount, sequence) {
      return Promise.resolve({
        id: refundId ?? "re_" + id.replaceAll("-", "") + String(sequence),
        status: refundStatus,
      });
    },
  };
  const config = {
    key: "sk_test_synthetic",
    account: "acct_synthetic",
    webhookSecret: "whsec_synthetic",
    returnOrigin: "https://store.example.test",
  };
  const env = {
    ...baseEnv,
    APP_ENV: "test",
    ONLINE_PAYMENT_ENABLED: "true",
    ONLINE_PAYMENT_PROCESSING_ENABLED: "true",
    DELIVERY_ORDERING_ENABLED: "true",
    STRIPE_TEST_SECRET_KEY: config.key,
    STRIPE_TEST_ACCOUNT_ID: config.account,
    STRIPE_TEST_WEBHOOK_SECRET: config.webhookSecret,
    PAYMENT_RETURN_ORIGIN: config.returnOrigin,
    PAYMENT_ACCESS_SECRET: "synthetic-payment-secret-at-least-32-bytes",
  };
  const worker = createApiWorker(
    undefined,
    { error: vi.fn() },
    undefined,
    undefined,
    undefined,
    {
      verify: vi
        .fn()
        .mockResolvedValue({ userId: "f1000000-0000-0000-0000-000000000001", aal: "aal2" }),
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    provider,
  );
  const base = "https://api.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte";
  const post = (resource: string, data: unknown) =>
    worker.fetch(
      new Request(base + "/" + resource, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      }),
      env,
    );
  const dashboard =
    "https://api.test/v1/dashboard/restaurants/f2000000-0000-0000-0000-000000000001/locations/f3000000-0000-0000-0000-000000000001/orders";
  const dashboardPost = (id: string, suffix: string, body: unknown) =>
    worker.fetch(
      new Request(`${dashboard}/${id}/${suffix}`, {
        method: "POST",
        headers: {
          authorization: "Bearer header.payload.signature",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      env,
    );
  const when = (hours: number) => {
    const d = new Date(Date.now() + hours * 3600000);
    d.setUTCMinutes(0, 0, 0);
    return d.toISOString();
  };
  const command = {
    menuId: "f4000000-0000-0000-0000-000000000001",
    menuVersionId: "f5000000-0000-0000-0000-000000000001",
    requestedFor: when(6),
    lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 2 }],
    submissionKey: "online-integration-order",
    customer: { contactName: "Synthetic Online Guest", phoneE164: "+999100000041", email: null },
    privacyNoticeVersion: "preview-v1",
    fulfillmentType: "pickup",
  };
  const response = await post("online-orders", command);
  expect(response.status).toBe(201);
  const raw: unknown = await response.json();
  const confirmation = parseOnlineOrderConfirmation(object(raw)?.data);
  if (!confirmation) throw new Error("Invalid online confirmation");
  const repeat: unknown = await (await post("online-orders", command)).json();
  expect(object(object(repeat)?.data)?.orderId).toBe(confirmation.orderId);
  const action = {
    orderId: confirmation.orderId,
    paymentAccessToken: confirmation.paymentAccessToken,
    paymentDeadline: confirmation.paymentDeadline,
  };
  expect(
    (
      await post("payment-session", {
        ...action,
        paymentAccessToken: confirmation.statusAccessToken,
      })
    ).status,
  ).toBe(404);
  const due = async (id: string) => {
    await admin.query(
      "update public.online_payment_jobs set next_at=statement_timestamp(),last_resume_at=null where order_id=$1",
      [id],
    );
  };
  const run = async (id: string) => {
    await due(id);
    await processOnlinePayment(
      env.HYPERDRIVE!.connectionString,
      config,
      postgresOnlineRepository,
      provider,
      id,
    );
  };
  // Recover a lost creation response using the same provider idempotency key.
  await post("payment-session", action);
  expect(creates).toBe(1);
  await due(confirmation.orderId);
  const resumed = await post("payment-session", action);
  expect(resumed.status).toBe(200);
  expect(creates).toBe(1);
  const opened: unknown = await resumed.json();
  expect(object(object(opened)?.data)?.checkoutUrl).toContain("https://checkout.stripe.com/");
  expect(
    (
      await dashboardPost(confirmation.orderId, "status", {
        expectedStatus: "submitted",
        targetStatus: "accepted",
      })
    ).status,
  ).toBe(409);
  const job = await postgresOnlineRepository.read(
    env.HYPERDRIVE!.connectionString,
    config.account,
    confirmation.orderId,
  );
  if (!job) throw new Error("Job missing");
  const session = sessions.get(job.id)!;
  session.paid = true;
  session.status = "complete";
  session.intent = "pi_" + job.id.replaceAll("-", "");
  session.url = null;
  await run(confirmation.orderId);
  const status = await post("order-status", {
    orderId: confirmation.orderId,
    statusAccessToken: confirmation.statusAccessToken,
  });
  const statusRaw: unknown = await status.json();
  expect(object(object(statusRaw)?.data)?.paymentState).toBe("paid");
  expect(JSON.stringify(statusRaw)).not.toContain("cs_test");
  expect(
    (
      await dashboardPost(confirmation.orderId, "status", {
        expectedStatus: "submitted",
        targetStatus: "accepted",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await dashboardPost(confirmation.orderId, "status", {
        expectedStatus: "accepted",
        targetStatus: "cancelled",
      })
    ).status,
  ).toBe(200);
  await run(confirmation.orderId);
  expect(
    (
      await postgresOnlineRepository.read(
        env.HYPERDRIVE!.connectionString,
        config.account,
        confirmation.orderId,
      )
    )?.refund_state,
  ).toBe("failed");
  expect((await dashboardPost(confirmation.orderId, "refund-retry", {})).status).toBe(200);
  refundStatus = "succeeded";
  await run(confirmation.orderId);
  expect(
    (
      await postgresOnlineRepository.read(
        env.HYPERDRIVE!.connectionString,
        config.account,
        confirmation.orderId,
      )
    )?.refund_state,
  ).toBe("succeeded");
  const payment = await admin.query<{ refunded_amount_minor: string }>(
    "select refunded_amount_minor from public.order_payments where order_id=$1",
    [confirmation.orderId],
  );
  expect(payment.rows[0]?.refunded_amount_minor).toBe("2500");

  // Delivery uses the exact quote, including the current 450-cent delivery fee.
  const requestedFor = when(7);
  const q = await post("delivery-quote", {
    menuId: command.menuId,
    menuVersionId: command.menuVersionId,
    requestedFor,
    lines: command.lines,
    postalCode: "52062",
  });
  expect(q.status).toBe(200);
  const qRaw: unknown = await q.json();
  const quote = parseDeliveryQuote(object(qRaw)?.data);
  if (!quote) throw new Error("Quote missing");
  const delivery = {
    ...command,
    fulfillmentType: "delivery",
    requestedFor,
    submissionKey: "online-delivery-race-one",
    expectedQuote: quote,
    delivery: {
      addressLine1: "Synthetic Onlineweg 10",
      addressLine2: null,
      postalCode: "52062",
      city: "Aachen",
      countryCode: "DE",
    },
  };
  const raced = await Promise.all([
    post("online-orders", delivery),
    post("online-orders", { ...delivery, submissionKey: "online-delivery-race-two" }),
  ]);
  expect(raced.map((r) => r.status).sort()).toEqual([201, 409]);
  const deliveredRaw: unknown = await raced.find((r) => r.status === 201)!.json();
  const delivered = parseOnlineOrderConfirmation(object(deliveredRaw)?.data);
  if (!delivered) throw new Error("Delivery missing");
  expect(delivered.totalAmountMinor).toBe(2950);
  // Expiry is driven by the backend; an unexpired browser token cannot extend it.
  await admin.query(
    "update public.online_payment_jobs set deadline=statement_timestamp()-interval '1 second' where order_id=$1",
    [delivered.orderId],
  );
  await run(delivered.orderId);
  const expired = await postgresOnlineRepository.read(
    env.HYPERDRIVE!.connectionString,
    config.account,
    delivered.orderId,
  );
  expect(expired?.order_status).toBe("cancelled");
  expect(expired?.payment_status).toBe("expired");
  // A later provider success never revives the cancelled order; it schedules compensation.
  const late = sessions.get(expired!.id)!;
  late.paid = true;
  late.status = "complete";
  late.intent = "pi_" + expired!.id.replaceAll("-", "");
  await run(delivered.orderId);
  await run(delivered.orderId);
  const compensated = await postgresOnlineRepository.read(
    env.HYPERDRIVE!.connectionString,
    config.account,
    delivered.orderId,
  );
  expect(compensated?.order_status).toBe("cancelled");
  expect(compensated?.refund_state).toBe("succeeded");
  const audit = await admin.query<{ count: string }>(
    "select count(*) from public.online_refund_retries",
  );
  expect(audit.rows[0]?.count).toBe("1");
}
