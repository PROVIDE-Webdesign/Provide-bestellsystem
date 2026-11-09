import type { Client } from "pg";
import { expect, vi } from "vitest";
import { object, parseOnlineOrderConfirmation, parseDeliveryQuote } from "@provide/contracts";
import { createProtectedIntegrationWorker as createApiWorker } from "./checkout-integration-fixture.js";
import { postgresOnlineRepository } from "./online-payments-database.js";
import { dispatchOnlinePayments, processOnlinePayment } from "./online-payments.js";
import type { ProviderSession } from "./stripe-sandbox.js";
import type { PaymentProvider } from "./online-payments.js";

export async function verifyOnlineIntegration(
  admin: Client,
  baseEnv: Parameters<ReturnType<typeof createApiWorker>["fetch"]>[1],
) {
  await admin.query(
    "insert into public.restaurant_feature_flags(restaurant_id,feature_key,enabled) values('f2000000-0000-0000-0000-000000000001','payment.online',true)",
  );
  await admin.query(
    "insert into private.restaurant_test_payment_accounts(restaurant_id,platform_account_id,merchant_account_id,enabled,expires_at,reason) values('f2000000-0000-0000-0000-000000000001','acct_synthetic','acct_restaurantA',true,clock_timestamp()+interval '1 day','Synthetic Connect integration fixture')",
  );
  const sessions = new Map<string, ProviderSession>();
  let creates = 0;
  let failFirstCreate = true;
  let refundStatus: "failed" | "succeeded" = "failed";
  let captures = 0,
    releases = 0;
  let loseCaptureReply = true;
  const provider: PaymentProvider = {
    settleAuthorization(merchant, job, action) {
      expect(merchant.merchantAccount).toBe("acct_restaurantA");
      const session = sessions.get(job.id);
      if (!session || !session.authorized || session.intent !== job.intentId)
        return Promise.reject(new Error("Unexpected settlement"));
      session.authorized = false;
      if (action === "capture") {
        captures++;
        session.paid = true;
        if (loseCaptureReply) {
          loseCaptureReply = false;
          return Promise.reject(new Error("Synthetic loss after Stripe accepted capture"));
        }
      } else {
        releases++;
        session.authorizationReleased = true;
      }
      return Promise.resolve();
    },
    session(_config, j) {
      expect(_config.merchantAccount).toBe("acct_restaurantA");
      const mode = _config.mode ?? "test";
      if (mode === "live") expect(j.captureMethod).toBe("manual");
      let session = sessions.get(j.id);
      if (!session) {
        creates++;
        const suffix = j.id.replaceAll("-", "");
        session = {
          id: `cs_${mode}_` + suffix,
          status: "open",
          paid: false,
          intent: null,
          url: `https://checkout.stripe.com/c/pay/cs_${mode}_` + suffix,
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
      expect(_config.merchantAccount).toBe("acct_restaurantA");
      const s = [...sessions.values()].find((s) => s.id === id);
      if (!s) throw new Error("Unknown synthetic session");
      s.status = "expired";
      s.url = null;
      return Promise.resolve();
    },
    refund(_config, _intent, id, refundId, _amount, sequence) {
      expect(_config.merchantAccount).toBe("acct_restaurantA");
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
      verify: vi.fn().mockResolvedValue({
        userId: "f1000000-0000-0000-0000-000000000001",
        sessionId: "f1000000-0000-0000-0000-000000000001",
        aal: "aal2",
      }),
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
  const post = (resource: string, data: unknown, runtime: typeof baseEnv = env) =>
    worker.fetch(
      new Request(base + "/" + resource, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      }),
      runtime,
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
    customer: {
      contactName: "Synthetic Online Guest",
      phoneE164: "+999100000041",
      email: "synthetic@example.invalid",
    },
    privacyNoticeVersion: "preview-v1",
    fulfillmentType: "pickup",
  };
  const markExistingAutomatic = (id: string) =>
    admin.query("update public.online_payment_jobs set capture_method=$2 where order_id=$1", [
      id,
      "automatic",
    ]);
  const response = await post("online-orders", command);
  expect(response.status).toBe(201);
  const raw: unknown = await response.json();
  const confirmation = parseOnlineOrderConfirmation(object(raw)?.data);
  if (!confirmation) throw new Error("Invalid online confirmation");
  await markExistingAutomatic(confirmation.orderId);
  expect(
    (
      await admin.query<{ n: number }>(
        "select count(*)::integer as n from private.order_acceptance_alerts where order_id=$1",
        [confirmation.orderId],
      )
    ).rows[0]?.n,
  ).toBe(0);
  expect(confirmation.orderNumber).toMatch(/^BS-[0-9]{8,19}$/);
  const repeat: unknown = await (await post("online-orders", command)).json();
  expect(object(object(repeat)?.data)?.orderId).toBe(confirmation.orderId);
  expect(object(object(repeat)?.data)?.orderNumber).toBe(confirmation.orderNumber);
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
  expect(
    (
      await admin.query<{ n: number }>(
        "select count(*)::integer as n from private.order_acceptance_alerts where order_id=$1 and resolved_at is null and deadline=started_at+interval '5 minutes'",
        [confirmation.orderId],
      )
    ).rows[0]?.n,
  ).toBe(1);
  const independentClock = await admin.query<{ independent: boolean }>(
    "select a.deadline<>j.deadline as independent from private.order_acceptance_alerts a join public.online_payment_jobs j on j.order_id=a.order_id where a.order_id=$1",
    [confirmation.orderId],
  );
  expect(independentClock.rows[0]?.independent).toBe(true);
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
  const tillJob = await postgresOnlineRepository.read(
    env.HYPERDRIVE!.connectionString,
    config.account,
    confirmation.orderId,
  );
  expect(tillJob).toMatchObject({
    order_status: "cancelled",
    refund_at_till: true,
    refund_state: "none",
  });
  expect((await dashboardPost(confirmation.orderId, "refund-retry", {})).status).toBe(404);
  const payment = await admin.query<{ refunded_amount_minor: string }>(
    "select refunded_amount_minor from public.order_payments where order_id=$1",
    [confirmation.orderId],
  );
  expect(payment.rows[0]?.refunded_amount_minor).toBe("0");
  refundStatus = "succeeded";

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

  // A signed success received before the deadline remains payable when reconciliation runs later.
  const timelyRaw: unknown = await (
    await post("online-orders", {
      ...command,
      submissionKey: "online-timely-delayed-reconciliation",
      requestedFor: when(8),
    })
  ).json();
  const timelyOrder = parseOnlineOrderConfirmation(object(timelyRaw)?.data);
  if (!timelyOrder) throw new Error("Timely order missing");
  await markExistingAutomatic(timelyOrder.orderId);
  await post("payment-session", {
    orderId: timelyOrder.orderId,
    paymentAccessToken: timelyOrder.paymentAccessToken,
    paymentDeadline: timelyOrder.paymentDeadline,
  });
  const timelyJob = await postgresOnlineRepository.read(
    env.HYPERDRIVE!.connectionString,
    config.account,
    timelyOrder.orderId,
  );
  if (!timelyJob?.session_id) throw new Error("Timely session missing");
  await admin.query(
    "update public.online_payment_jobs set deadline=statement_timestamp()+interval '1 second' where order_id=$1",
    [timelyOrder.orderId],
  );
  await postgresOnlineRepository.event(
    env.HYPERDRIVE!.connectionString,
    config.account,
    "evt_timelysynthetic",
    "checkout.session.completed",
    timelyJob.session_id,
    "a".repeat(64),
    new Date().toISOString(),
    "acct_restaurantA",
    true,
  );
  const timelySession = sessions.get(timelyJob.id)!;
  timelySession.paid = true;
  timelySession.status = "complete";
  timelySession.intent = "pi_" + timelyJob.id.replaceAll("-", "");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await run(timelyOrder.orderId);
  const reconciled = await postgresOnlineRepository.read(
    env.HYPERDRIVE!.connectionString,
    config.account,
    timelyOrder.orderId,
  );
  expect(reconciled?.order_status).toBe("submitted");
  expect(reconciled?.payment_status).toBe("captured");
  expect(reconciled?.refund_state).toBe("none");

  // Without reliable success time the order remains blocked for manual review.
  const uncertainRaw: unknown = await (
    await post("online-orders", {
      ...command,
      submissionKey: "online-uncertain-delayed-reconciliation",
      requestedFor: when(9),
    })
  ).json();
  const uncertainOrder = parseOnlineOrderConfirmation(object(uncertainRaw)?.data);
  if (!uncertainOrder) throw new Error("Uncertain order missing");
  await markExistingAutomatic(uncertainOrder.orderId);
  await post("payment-session", {
    orderId: uncertainOrder.orderId,
    paymentAccessToken: uncertainOrder.paymentAccessToken,
    paymentDeadline: uncertainOrder.paymentDeadline,
  });
  const uncertainJob = await postgresOnlineRepository.read(
    env.HYPERDRIVE!.connectionString,
    config.account,
    uncertainOrder.orderId,
  );
  if (!uncertainJob?.session_id) throw new Error("Uncertain session missing");
  const uncertainSession = sessions.get(uncertainJob.id)!;
  uncertainSession.paid = true;
  uncertainSession.status = "complete";
  uncertainSession.intent = "pi_" + uncertainJob.id.replaceAll("-", "");
  const confirmedBeforeDeadline = new Date().toISOString();
  await admin.query(
    "update public.online_payment_jobs set deadline=statement_timestamp()+interval '2 seconds' where order_id=$1",
    [uncertainOrder.orderId],
  );
  await new Promise((resolve) => setTimeout(resolve, 2200));
  await run(uncertainOrder.orderId);
  const held = await postgresOnlineRepository.read(
    env.HYPERDRIVE!.connectionString,
    config.account,
    uncertainOrder.orderId,
  );
  expect(held?.order_status).toBe("submitted");
  expect(held?.payment_status).toBe("pending_customer");
  expect(held?.last_error).toBe("manual_review");
  await postgresOnlineRepository.event(
    env.HYPERDRIVE!.connectionString,
    config.account,
    "evt_uncertainsynthetic",
    "payment_intent.succeeded",
    uncertainSession.intent,
    "b".repeat(64),
    confirmedBeforeDeadline,
    "acct_restaurantA",
    true,
  );
  await run(uncertainOrder.orderId);
  const recovered = await postgresOnlineRepository.read(
    env.HYPERDRIVE!.connectionString,
    config.account,
    uncertainOrder.orderId,
  );
  expect(recovered?.order_status).toBe("submitted");
  expect(recovered?.payment_status).toBe("captured");
  expect(recovered?.last_error).toBeNull();

  const audit = await admin.query<{ count: string }>(
    "select count(*) from public.online_refund_retries",
  );
  expect(audit.rows[0]?.count).toBe("0");

  const read = (id: string) =>
    postgresOnlineRepository.read(env.HYPERDRIVE!.connectionString, config.account, id);
  async function authorizeFixture(label: string, hours: number) {
    const response = await post("online-orders", {
      ...command,
      submissionKey: "p2-manual-" + label,
      requestedFor: when(hours),
    });
    expect(response.status).toBe(201);
    const order = parseOnlineOrderConfirmation(object(await response.json())?.data);
    if (!order) throw new Error("Manual fixture missing");
    expect(
      (
        await post("payment-session", {
          orderId: order.orderId,
          paymentAccessToken: order.paymentAccessToken,
          paymentDeadline: order.paymentDeadline,
        })
      ).status,
    ).toBe(200);
    const job = await read(order.orderId);
    expect(job?.capture_method).toBe("manual");
    const session = sessions.get(job!.id)!;
    session.status = "complete";
    session.authorized = true;
    session.intent = "pi_" + job!.id.replaceAll("-", "");
    await run(order.orderId);
    expect(await read(order.orderId)).toMatchObject({
      order_status: "submitted",
      payment_status: "authorized",
    });
    return order.orderId;
  }
  const accepted = await authorizeFixture("accept-retry", 10);
  const accept = { expectedStatus: "submitted", targetStatus: "accepted" };
  expect((await dashboardPost(accepted, "status", accept)).status).toBe(200);
  expect(await read(accepted)).toMatchObject({
    order_status: "submitted",
    payment_status: "authorized",
  });
  await run(accepted);
  expect(await read(accepted)).toMatchObject({
    order_status: "submitted",
    payment_status: "authorized",
  });
  await run(accepted);
  expect(await read(accepted)).toMatchObject({
    order_status: "accepted",
    payment_status: "captured",
  });
  expect((await dashboardPost(accepted, "status", accept)).status).toBe(409);
  await run(accepted);
  expect(captures).toBe(1);
  expect(
    (
      await dashboardPost(accepted, "status", {
        expectedStatus: "accepted",
        targetStatus: "cancelled",
      })
    ).status,
  ).toBe(200);
  await run(accepted);
  expect(await read(accepted)).toMatchObject({
    order_status: "cancelled",
    payment_status: "captured",
    refund_at_till: true,
    refund_state: "none",
  });
  const rejected = await authorizeFixture("reject", 11);
  expect(
    (
      await dashboardPost(rejected, "status", {
        expectedStatus: "submitted",
        targetStatus: "rejected",
      })
    ).status,
  ).toBe(200);
  await run(rejected);
  expect(await read(rejected)).toMatchObject({
    order_status: "rejected",
    payment_status: "expired",
    refund_state: "none",
  });
  const expiredAuth = await authorizeFixture("expire", 12);
  await admin.query(
    "update public.online_payment_jobs set acceptance_deadline=statement_timestamp()-interval '1 second' where order_id=$1",
    [expiredAuth],
  );
  await run(expiredAuth);
  expect(await read(expiredAuth)).toMatchObject({
    order_status: "cancelled",
    payment_status: "expired",
    refund_state: "none",
  });
  expect(captures).toBe(1);
  expect(releases).toBe(2);
  console.log(
    "P2 matrix: authorized, no early acceptance, lost capture response, duplicate action, till refund after cancellation, rejected authorization, expired authorization",
  );

  return async function verifyLiveOnlineIntegration() {
    // The exact checkout dispatcher, SQL receipt and webhook path in production mode,
    // backed only by the local database and the provider double above.
    const liveOrigin = "https://checkout.provide-fixture.de";
    const liveEnv = {
      ...env,
      APP_ENV: "production",
      ONLINE_LIVE_PAYMENT_ENABLED: "true",
      ONLINE_LIVE_PAYMENT_PROCESSING_ENABLED: "true",
      STRIPE_LIVE_SECRET_KEY: "rk_live_fixture",
      STRIPE_LIVE_ACCOUNT_ID: config.account,
      STRIPE_LIVE_WEBHOOK_SECRET: "whsec_live_fixture",
      CHECKOUT_STOREFRONT_ORIGIN: liveOrigin,
      CHECKOUT_PRIVACY_NOTICE_VERSION: "live-fixture-v1",
      PAYMENT_RETURN_ORIGIN: liveOrigin,
    };
    const liveOrder = {
      ...command,
      submissionKey: "live-order-fixture",
      privacyNoticeVersion: liveEnv.CHECKOUT_PRIVACY_NOTICE_VERSION,
      requestedFor: when(13),
    };
    await admin.query(
      "insert into private.restaurant_live_payment_accounts(restaurant_id,platform_account_id,merchant_account_id) values('f2000000-0000-0000-0000-000000000001',$1,$2)",
      [config.account, "acct_restaurantA"],
    );
    const liveCatalog = async () => {
      const response = await worker.fetch(new Request(base + "/catalog"), liveEnv);
      expect(response.status).toBe(200);
      return object(object(await response.json())?.data)?.liveOnlinePaymentAvailable;
    };
    expect(await liveCatalog()).toBe(false);
    expect((await post("online-orders", liveOrder, liveEnv)).status).toBe(409);
    await admin.query("update private.restaurant_live_payment_accounts set enabled=true");
    expect(await liveCatalog()).toBe(true);
    await admin.query(
      "insert into private.synthetic_test_environment(project_ref,expires_at) values('stripefixtureproject',clock_timestamp()+interval '1 hour')",
    );
    expect(await liveCatalog()).toBe(false);
    await admin.query(
      "delete from private.synthetic_test_environment where project_ref='stripefixtureproject'",
    );
    expect(
      (await post("online-orders", liveOrder, { ...liveEnv, ONLINE_LIVE_PAYMENT_ENABLED: "false" }))
        .status,
    ).toBe(503);
    const liveResponse = await post("online-orders", liveOrder, liveEnv);
    expect(liveResponse.status).toBe(201);
    const live = parseOnlineOrderConfirmation(object(await liveResponse.json())?.data);
    if (!live) throw new Error("Live checkout confirmation missing");
    const liveAction = {
      orderId: live.orderId,
      paymentDeadline: live.paymentDeadline,
      paymentAccessToken: live.paymentAccessToken,
    };
    const repeated = parseOnlineOrderConfirmation(
      object(await (await post("online-orders", liveOrder, liveEnv)).json())?.data,
    );
    expect(repeated).toEqual(live);
    expect((await post("payment-session", liveAction, env)).status).toBe(404);
    const noNewLiveOrders = { ...liveEnv, ONLINE_LIVE_PAYMENT_ENABLED: "false" };
    const checkout = await post("payment-session", liveAction, noNewLiveOrders);
    expect(checkout.status).toBe(200);
    expect(object(object(await checkout.json())?.data)?.checkoutUrl).toMatch(
      /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_live_/,
    );
    const readLive = () =>
      postgresOnlineRepository.read(
        env.HYPERDRIVE!.connectionString,
        config.account,
        live.orderId,
        "live",
      );
    const liveJob = await readLive();
    if (!liveJob?.session_id) throw new Error("Live payment job missing");
    expect(liveJob).toMatchObject({ stripe_mode: "live", capture_method: "manual" });
    expect(await read(live.orderId)).toBeNull();
    expect(
      await postgresOnlineRepository.claim(
        env.HYPERDRIVE!.connectionString,
        config.account,
        live.orderId,
        crypto.randomUUID(),
        "test",
      ),
    ).toBeNull();
    const liveSession = sessions.get(liveJob.id)!;
    liveSession.status = "complete";
    liveSession.authorized = true;
    liveSession.intent = "pi_" + liveJob.id.replaceAll("-", "");
    const webhook = async (
      event: string,
      merchant: string | null,
      livemode: boolean,
      objectId: string,
      signingSecret = liveEnv.STRIPE_LIVE_WEBHOOK_SECRET,
    ) => {
      const time = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({
        id: event,
        ...(merchant ? { account: merchant } : {}),
        livemode,
        created: time,
        type: "checkout.session.completed",
        data: { object: { id: objectId, payment_status: "unpaid", livemode } },
      });
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(signingSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const bytes = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(time + "." + body),
      );
      const sig = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join(
        "",
      );
      return worker.fetch(
        new Request("https://api.test/v1/payments/stripe/webhook", {
          method: "POST",
          body,
          headers: { "stripe-signature": `t=${time},v1=${sig}` },
        }),
        noNewLiveOrders,
      );
    };
    expect(
      (
        await webhook(
          "evt_badsecret",
          "acct_restaurantA",
          true,
          liveJob.session_id,
          config.webhookSecret,
        )
      ).status,
    ).toBe(400);
    expect(
      (await webhook("evt_mixedmode", "acct_restaurantA", true, "cs_test_fixture")).status,
    ).toBe(400);
    expect(
      (await webhook("evt_testmode", "acct_restaurantA", false, "cs_test_fixture")).status,
    ).toBe(204);
    expect((await webhook("evt_noaccount", null, true, liveJob.session_id)).status).toBe(400);
    expect(
      (await webhook("evt_foreignmerchant", "acct_foreign", true, liveJob.session_id)).status,
    ).toBe(204);
    expect((await readLive())?.payment_status).toBe("pending_customer");
    expect(
      (await admin.query("select 1 from public.online_payment_inbox where stripe_mode='live'"))
        .rowCount,
    ).toBe(0);
    expect(
      (await webhook("evt_liveconnected", "acct_restaurantA", true, liveJob.session_id)).status,
    ).toBe(204);
    expect(await readLive()).toMatchObject({
      order_status: "submitted",
      payment_status: "authorized",
    });
    expect((await dashboardPost(live.orderId, "status", accept)).status).toBe(200);
    expect((await readLive())?.order_status).toBe("submitted");
    await dispatchOnlinePayments(noNewLiveOrders, postgresOnlineRepository, provider);
    expect(await readLive()).toMatchObject({
      order_status: "accepted",
      payment_status: "captured",
    });
    await dispatchOnlinePayments(noNewLiveOrders, postgresOnlineRepository, provider);
    expect(captures).toBe(2);
    expect(
      (
        await dashboardPost(live.orderId, "status", {
          expectedStatus: "accepted",
          targetStatus: "cancelled",
        })
      ).status,
    ).toBe(200);
    await admin.query("update private.restaurant_live_payment_accounts set enabled=false");
    await dispatchOnlinePayments(noNewLiveOrders, postgresOnlineRepository, provider);
    expect(await readLive()).toMatchObject({
      order_status: "cancelled",
      payment_status: "captured",
      refund_at_till: true,
      refund_state: "none",
    });
    expect(
      (
        await admin.query(
          "select 1 from public.payment_attempts where provider_key='stripe_live' and provider_payment_reference=$1",
          [liveJob.session_id],
        )
      ).rowCount,
    ).toBe(1);
    console.log(
      "Live matrix: opt-in, atomic receipt replay, test isolation, signed Connect webhook, capture on acceptance, till refund after cancellation",
    );
    // An authorized acceptance can outlive the member's access. A confirmed
    // provider capture must remain in the ledger and be compensated, not rolled back.
    for (const [label, change, hours] of [
      ["suspended", "status='suspended'", 14],
      ["viewer", "role='viewer'", 15],
      ["unassigned", "role='manager'", 16],
    ] as const) {
      const order = await authorizeFixture("access-lost-" + label, hours);
      expect((await dashboardPost(order, "status", accept)).status).toBe(200);
      const beforeCaptures = captures;
      await admin.query(
        "update public.restaurant_memberships set " +
          change +
          " where restaurant_id='f2000000-0000-0000-0000-000000000001' and user_id='f1000000-0000-0000-0000-000000000001'",
      );
      try {
        await run(order);
        expect(await read(order)).toMatchObject({
          order_status: "cancelled",
          payment_status: "captured",
          refund_state: "requested",
          last_error: null,
        });
        await run(order);
        expect(await read(order)).toMatchObject({
          order_status: "cancelled",
          payment_status: "refunded",
          refund_state: "succeeded",
          last_error: null,
        });
        await run(order);
        expect(captures).toBe(beforeCaptures + 1);
        expect(
          (
            await admin.query<{ n: number }>(
              "select count(*)::integer n from public.order_status_events where order_id=$1 and to_status='accepted'",
              [order],
            )
          ).rows[0]?.n,
        ).toBe(0);
      } finally {
        await admin.query(
          "update public.restaurant_memberships set status='active',role='owner' where restaurant_id='f2000000-0000-0000-0000-000000000001' and user_id='f1000000-0000-0000-0000-000000000001'",
        );
      }
    }
    console.log(
      "Settlement access-loss matrix: suspended, viewer and unassigned actors compensated without duplicate capture",
    );
  };
}
