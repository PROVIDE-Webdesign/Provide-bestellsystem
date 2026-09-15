import {
  isStorefrontScope,
  object,
  parseOnlineOrderRequest,
  parseOnlineOrderConfirmation,
  parsePaymentAction,
  parsePaymentSession,
  type StorefrontScope,
  type PaymentState,
} from "@provide/contracts";
import type { CheckoutEnvironment } from "./checkout.js";
import type { RequestContext } from "./context.js";
import { jsonError, jsonSuccess, readJsonBody, RequestBodyError } from "./http.js";
import {
  createStatusAccessToken,
  verifyStatusAccessToken,
  hasValidStatusSecret,
  statusAvailableUntil,
} from "./status-token.js";
import {
  digest,
  verifyStripeWebhook,
  type SandboxProvider,
  type SandboxConfig,
} from "./stripe-sandbox.js";
import type { OnlineRepository, OnlineJob } from "./online-payments-database.js";
export interface OnlineEnvironment extends CheckoutEnvironment {
  APP_ENV: string;
  ONLINE_PAYMENT_ENABLED?: string;
  ONLINE_PAYMENT_PROCESSING_ENABLED?: string;
  DELIVERY_ORDERING_ENABLED?: string;
  STRIPE_TEST_SECRET_KEY?: string;
  STRIPE_TEST_ACCOUNT_ID?: string;
  STRIPE_TEST_WEBHOOK_SECRET?: string;
  PAYMENT_ACCESS_SECRET?: string;
  PAYMENT_RETURN_ORIGIN?: string;
}
export function sandboxConfig(env: OnlineEnvironment): SandboxConfig | undefined {
  if (
    !["test", "local", "preview"].includes(env.APP_ENV) ||
    env.ONLINE_PAYMENT_PROCESSING_ENABLED !== "true" ||
    !env.STRIPE_TEST_SECRET_KEY?.startsWith("sk_test_") ||
    !/^acct_[A-Za-z0-9]+$/.test(env.STRIPE_TEST_ACCOUNT_ID ?? "") ||
    !env.STRIPE_TEST_WEBHOOK_SECRET?.startsWith("whsec_") ||
    !hasValidStatusSecret(env.PAYMENT_ACCESS_SECRET) ||
    !env.HYPERDRIVE ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true"
  )
    return;
  try {
    const u = new URL(env.PAYMENT_RETURN_ORIGIN ?? "");
    if (
      u.origin !== env.PAYMENT_RETURN_ORIGIN ||
      u.username ||
      u.password ||
      !(
        u.protocol === "https:" ||
        (env.APP_ENV !== "preview" &&
          ["localhost", "127.0.0.1"].includes(u.hostname) &&
          u.protocol === "http:")
      )
    )
      return;
    return {
      key: env.STRIPE_TEST_SECRET_KEY,
      account: env.STRIPE_TEST_ACCOUNT_ID!,
      webhookSecret: env.STRIPE_TEST_WEBHOOK_SECRET,
      returnOrigin: u.origin,
    };
  } catch {
    return;
  }
}
function paymentTokenScope(scope: StorefrontScope, deadline: string): StorefrontScope {
  return {
    restaurantSlug: "payment-action-v1:" + scope.restaurantSlug,
    locationSlug: scope.locationSlug + ":" + deadline,
  };
}
export async function createPaymentToken(
  secret: string,
  scope: StorefrontScope,
  order: string,
  deadline: string,
) {
  return createStatusAccessToken(secret, paymentTokenScope(scope, deadline), order);
}
export async function verifyPaymentToken(
  secret: string,
  scope: StorefrontScope,
  order: string,
  deadline: string,
  token: string,
) {
  return (
    Date.parse(deadline) > Date.now() &&
    Date.parse(deadline) <= Date.now() + 10 * 60 * 1000 &&
    verifyStatusAccessToken(token, [secret], paymentTokenScope(scope, deadline), order)
  );
}
export function onlineState(j: OnlineJob): PaymentState {
  if (j.last_error === "manual_review") return "review";
  if (j.refund_state === "succeeded") return "refunded";
  if (j.refund_state === "failed") return "refund_failed";
  if (["requested", "pending"].includes(j.refund_state)) return "refund_pending";
  if (j.close_requested && !j.provider_terminal) return "cancelling";
  if (j.payment_status === "captured") return "paid";
  if (["failed", "cancelled", "expired"].includes(j.payment_status)) return "expired";
  return j.last_error || Date.parse(j.deadline) <= Date.now() ? "checking" : "open";
}
export async function processOnlinePayment(
  connection: string,
  config: SandboxConfig,
  repo: OnlineRepository,
  provider: SandboxProvider,
  order: string | null = null,
) {
  const lease = crypto.randomUUID();
  const j = await repo.claim(connection, config.account, order, lease);
  if (!j) return;
  try {
    if (!j.session_id && Date.now() - Date.parse(j.created_at) > 20 * 60 * 60 * 1000) {
      await repo.fail(connection, j.id, lease, true);
      return;
    }
    let session = await provider.session(config, j);
    if (!j.session_id) {
      await repo.bind(connection, j.id, lease, session.id);
      j.session_id = session.id;
    }
    const latest = await repo.read(connection, config.account, j.order_id);
    if (!latest) throw new Error("Missing online job");
    if (
      session.status === "open" &&
      (latest.close_requested || Date.parse(j.deadline) <= Date.now())
    ) {
      // A concurrent success may make expiration fail. Re-read before deciding anything.
      await provider.expire(config, session.id).catch(() => undefined);
      session = await provider.session(config, j);
    }
    let state = session.paid ? "paid" : session.status === "expired" ? "expired" : "open",
      refundId = j.refund_id;
    if (
      session.paid &&
      (latest.refund_state !== "none" ||
        latest.close_requested ||
        ["cancelled", "rejected"].includes(latest.order_status))
    ) {
      const refund = await provider.refund(
        config,
        session.intent!,
        j.id,
        j.refund_id,
        j.amount,
        j.refund_sequence,
      );
      refundId = refund.id;
      state =
        refund.status === "succeeded"
          ? "refunded"
          : refund.status === "failed"
            ? "refund_failed"
            : "refund_pending";
    }
    await repo.sync(
      connection,
      j.id,
      lease,
      state,
      session.intent,
      refundId,
      await digest(
        JSON.stringify({
          session: session.id,
          state,
          intent: session.intent,
          refund: refundId,
          amount: j.amount,
        }),
      ),
    );
  } catch {
    await repo.fail(connection, j.id, lease, false);
  }
}
export async function dispatchOnlinePayments(
  env: OnlineEnvironment,
  repo: OnlineRepository,
  provider: SandboxProvider,
) {
  const config = sandboxConfig(env);
  if (!config) return;
  // A bounded batch; leases and next_at avoid concurrent duplicate work.
  for (let i = 0; i < 10; i++)
    await processOnlinePayment(env.HYPERDRIVE!.connectionString, config, repo, provider);
}
export async function handleOnlinePayment(
  request: Request,
  scope: StorefrontScope,
  submit: boolean,
  env: OnlineEnvironment,
  repo: OnlineRepository,
  provider: SandboxProvider,
  ctx: RequestContext,
  cors: Headers,
) {
  const fail = (status: number) =>
    jsonError(
      status === 400
        ? "bad_request"
        : status === 404
          ? "not_found"
          : status === 409
            ? "order_unavailable"
            : "service_unavailable",
      "Online payment could not be processed.",
      ctx.requestId,
      status,
      cors,
    );
  if (!isStorefrontScope(scope) || new URL(request.url).search || request.url.length > 2048)
    return fail(400);
  const config = sandboxConfig(env);
  if (!config) return fail(503);
  try {
    const body = await readJsonBody(request);
    if (submit) {
      if (
        env.ONLINE_PAYMENT_ENABLED !== "true" ||
        env.CHECKOUT_WRITE_ENABLED !== "true" ||
        env.ORDER_STATUS_READ_ENABLED !== "true" ||
        !hasValidStatusSecret(env.ORDER_STATUS_TOKEN_SECRET) ||
        !env.CHECKOUT_PRIVACY_NOTICE_VERSION ||
        !/^[1-9][0-9]{0,2}$/.test(env.CHECKOUT_RETENTION_DAYS ?? "") ||
        Number(env.CHECKOUT_RETENTION_DAYS) > 730
      )
        return fail(503);
      const c = parseOnlineOrderRequest(body);
      if (!c || c.privacyNoticeVersion !== env.CHECKOUT_PRIVACY_NOTICE_VERSION) return fail(400);
      if (c.fulfillmentType === "delivery" && env.DELIVERY_ORDERING_ENABLED !== "true")
        return fail(503);
      const raw = object(
        await repo.submit(
          env.HYPERDRIVE!.connectionString,
          scope,
          c,
          Number(env.CHECKOUT_RETENTION_DAYS),
          config.account,
        ),
      );
      if (!raw || typeof raw.orderId !== "string" || typeof raw.paymentDeadline !== "string")
        return fail(503);
      const result = parseOnlineOrderConfirmation({
        ...raw,
        statusAccessToken: await createStatusAccessToken(
          env.ORDER_STATUS_TOKEN_SECRET,
          scope,
          raw.orderId,
        ),
        statusAvailableUntil: statusAvailableUntil(c.requestedFor),
        paymentAccessToken: await createPaymentToken(
          env.PAYMENT_ACCESS_SECRET!,
          scope,
          raw.orderId,
          raw.paymentDeadline,
        ),
      });
      return result ? jsonSuccess(result, ctx.requestId, 201, cors) : fail(503);
    }
    const action = parsePaymentAction(body);
    if (
      !action ||
      !(await verifyPaymentToken(
        env.PAYMENT_ACCESS_SECRET!,
        scope,
        action.orderId,
        action.paymentDeadline,
        action.paymentAccessToken,
      ))
    )
      return fail(404);
    let j = await repo.read(env.HYPERDRIVE!.connectionString, config.account, action.orderId);
    if (
      !j ||
      j.restaurant_slug !== scope.restaurantSlug ||
      j.location_slug !== scope.locationSlug ||
      Date.parse(j.deadline) !== Date.parse(action.paymentDeadline)
    )
      return fail(404);
    if (!(await repo.resume(env.HYPERDRIVE!.connectionString, config.account, action.orderId)))
      return jsonSuccess(
        { checkoutUrl: null, paymentState: onlineState(j) },
        ctx.requestId,
        200,
        cors,
      );
    await processOnlinePayment(
      env.HYPERDRIVE!.connectionString,
      config,
      repo,
      provider,
      action.orderId,
    );
    j = await repo.read(env.HYPERDRIVE!.connectionString, config.account, action.orderId);
    if (!j) return fail(404);
    let url: string | null = null;
    if (j.session_id && onlineState(j) === "open") {
      const session = await provider.session(config, j);
      if (session.status === "open" && !session.paid) url = session.url;
    }
    const result = parsePaymentSession({ checkoutUrl: url, paymentState: onlineState(j) });
    return result ? jsonSuccess(result, ctx.requestId, 200, cors) : fail(503);
  } catch (e) {
    if (e instanceof RequestBodyError) return fail(e.status);
    return fail(object(e)?.code === "P0001" ? 409 : 503);
  }
}
export async function handleStripeWebhook(
  request: Request,
  env: OnlineEnvironment,
  repo: OnlineRepository,
  ctx: RequestContext,
) {
  const config = sandboxConfig(env);
  if (!config) return jsonError("service_unavailable", "Webhook unavailable.", ctx.requestId, 503);
  try {
    if (
      new URL(request.url).search ||
      Number(request.headers.get("content-length") ?? 0) > 256 * 1024
    )
      return new Response(null, { status: 400 });
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 256 * 1024) return new Response(null, { status: 413 });
    const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    if (
      !(await verifyStripeWebhook(
        raw,
        request.headers.get("stripe-signature"),
        config.webhookSecret,
      ))
    )
      return new Response(null, { status: 400 });
    const event = object(JSON.parse(raw)),
      data = object(event?.data),
      value = object(data?.object);
    if (
      !event ||
      event.livemode !== false ||
      (event.account !== undefined && event.account !== config.account) ||
      typeof event.id !== "string" ||
      !/^evt_[A-Za-z0-9]+$/.test(event.id)
    )
      return new Response(null, { status: 400 });
    if (
      typeof event.type !== "string" ||
      ![
        "checkout.session.completed",
        "checkout.session.expired",
        "payment_intent.succeeded",
        "payment_intent.payment_failed",
        "refund.created",
        "refund.updated",
        "refund.failed",
      ].includes(event.type)
    )
      return new Response(null, { status: 204 });
    if (
      !value ||
      typeof value.id !== "string" ||
      !/^(cs_test_|pi_|re_)[A-Za-z0-9]+$/.test(value.id)
    )
      return new Response(null, { status: 400 });
    // Acknowledge only after durable storage. Raw provider payloads never enter the database.
    await repo.event(
      env.HYPERDRIVE!.connectionString,
      config.account,
      event.id,
      event.type,
      value.id,
      await digest(raw),
    );
    return new Response(null, { status: 204 });
  } catch {
    return jsonError("service_unavailable", "Webhook could not be recorded.", ctx.requestId, 503);
  }
}
