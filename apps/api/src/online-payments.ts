import {
  isStorefrontScope,
  isCheckoutTestHostname,
  type OnlinePaymentMode,
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
  type StripeConfig,
  type LiveStripeConfig,
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
  ONLINE_LIVE_PAYMENT_ENABLED?: string;
  ONLINE_LIVE_PAYMENT_PROCESSING_ENABLED?: string;
  STRIPE_LIVE_SECRET_KEY?: string;
  STRIPE_LIVE_ACCOUNT_ID?: string;
  STRIPE_LIVE_WEBHOOK_SECRET?: string;
  CHECKOUT_STOREFRONT_ORIGIN?: string;
  CHECKOUT_PROTECTION_ENABLED?: string;
  PAYMENT_ACCESS_SECRET?: string;
  PAYMENT_RETURN_ORIGIN?: string;
}
export function sandboxConfig(env: OnlineEnvironment): SandboxConfig | undefined {
  const key = env.STRIPE_TEST_SECRET_KEY;
  if (
    !["test", "local", "preview"].includes(env.APP_ENV) ||
    env.ONLINE_PAYMENT_PROCESSING_ENABLED !== "true" ||
    !key ||
    !/^(?:sk|rk)_test_[A-Za-z0-9_]+$/.test(key) ||
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
      key,
      account: env.STRIPE_TEST_ACCOUNT_ID!,
      webhookSecret: env.STRIPE_TEST_WEBHOOK_SECRET,
      returnOrigin: u.origin,
    };
  } catch {
    return;
  }
}
type ProcessingConfig = SandboxConfig | Omit<LiveStripeConfig, "merchantAccount">;
export type PaymentProvider = SandboxProvider<StripeConfig>;

function paymentConfig(env: Partial<OnlineEnvironment>): ProcessingConfig | undefined {
  if (env.APP_ENV !== "production")
    return env.APP_ENV ? sandboxConfig({ ...env, APP_ENV: env.APP_ENV }) : undefined;
  const key = env.STRIPE_LIVE_SECRET_KEY;
  const account = env.STRIPE_LIVE_ACCOUNT_ID;
  const webhookSecret = env.STRIPE_LIVE_WEBHOOK_SECRET;
  const returnOrigin = env.PAYMENT_RETURN_ORIGIN;
  if (
    env.ONLINE_LIVE_PAYMENT_PROCESSING_ENABLED !== "true" ||
    !key ||
    !/^rk_live_[A-Za-z0-9_]+$/.test(key) ||
    !account ||
    !/^acct_[A-Za-z0-9]+$/.test(account) ||
    !webhookSecret ||
    !/^whsec_[A-Za-z0-9_]+$/.test(webhookSecret) ||
    webhookSecret === env.STRIPE_TEST_WEBHOOK_SECRET ||
    !hasValidStatusSecret(env.PAYMENT_ACCESS_SECRET) ||
    !env.HYPERDRIVE ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true" ||
    !returnOrigin
  )
    return;
  try {
    const u = new URL(returnOrigin);
    if (u.protocol !== "https:" || u.origin !== returnOrigin || isCheckoutTestHostname(u.hostname))
      return;
    return { mode: "live", key, account, webhookSecret, returnOrigin };
  } catch {
    return;
  }
}

export function liveCheckoutPlatform(
  env: Partial<OnlineEnvironment>,
  config = paymentConfig(env),
): string | undefined {
  if (
    config?.mode === "live" &&
    env.ONLINE_LIVE_PAYMENT_ENABLED === "true" &&
    env.CHECKOUT_PROTECTION_ENABLED === "true" &&
    env.CHECKOUT_WRITE_ENABLED === "true" &&
    env.ORDER_STATUS_READ_ENABLED === "true" &&
    hasValidStatusSecret(env.ORDER_STATUS_TOKEN_SECRET) &&
    /^[1-9][0-9]{0,2}$/.test(env.CHECKOUT_RETENTION_DAYS ?? "") &&
    Number(env.CHECKOUT_RETENTION_DAYS) <= 730 &&
    env.CHECKOUT_STOREFRONT_ORIGIN === config.returnOrigin &&
    /^live-[A-Za-z0-9_-]+$/.test(env.CHECKOUT_PRIVACY_NOTICE_VERSION ?? "")
  )
    return config.account;
}

function paymentTokenScope(
  scope: StorefrontScope,
  deadline: string,
  mode: OnlinePaymentMode,
): StorefrontScope {
  return {
    restaurantSlug:
      (mode === "live" ? "payment-action-live-v1:" : "payment-action-v1:") + scope.restaurantSlug,
    locationSlug: scope.locationSlug + ":" + deadline,
  };
}
export async function createPaymentToken(
  secret: string,
  scope: StorefrontScope,
  order: string,
  deadline: string,
  mode: OnlinePaymentMode = "test",
) {
  return createStatusAccessToken(secret, paymentTokenScope(scope, deadline, mode), order);
}
export async function verifyPaymentToken(
  secret: string,
  scope: StorefrontScope,
  order: string,
  deadline: string,
  token: string,
  mode: OnlinePaymentMode = "test",
) {
  return (
    Date.parse(deadline) > Date.now() &&
    Date.parse(deadline) <= Date.now() + 10 * 60 * 1000 &&
    verifyStatusAccessToken(token, [secret], paymentTokenScope(scope, deadline, mode), order)
  );
}
export function onlineState(j: OnlineJob): PaymentState {
  if (j.last_error === "manual_review") return "review";
  if (j.refund_state === "succeeded") return "refunded";
  if (j.refund_state === "failed") return "refund_failed";
  if (["requested", "pending"].includes(j.refund_state)) return "refund_pending";
  if (j.close_requested && !j.provider_terminal) return "cancelling";
  if (j.payment_status === "authorized")
    return j.capture_requested_at ? "capture_pending" : "authorized";
  if (j.payment_status === "captured") return "paid";
  if (["failed", "cancelled", "expired"].includes(j.payment_status)) return "expired";
  return j.last_error || Date.parse(j.deadline) <= Date.now() ? "checking" : "open";
}
function paymentAccountConfig(config: ProcessingConfig, job: OnlineJob): StripeConfig {
  if (
    (job.stripe_mode ?? "test") !== (config.mode ?? "test") ||
    !/^acct_[A-Za-z0-9]+$/.test(job.account_id)
  )
    throw new Error("Invalid merchant payment job");
  if (config.mode === "live") {
    if (job.account_id === config.account || job.capture_method !== "manual")
      throw new Error("Invalid live merchant payment job");
    return { ...config, merchantAccount: job.account_id };
  }
  return job.account_id === config.account
    ? config
    : { ...config, merchantAccount: job.account_id };
}
function providerJobFor(job: OnlineJob) {
  return job.capture_method === "manual" ? { ...job, captureMethod: "manual" as const } : job;
}
export async function processOnlinePayment(
  connection: string,
  config: ProcessingConfig,
  repo: OnlineRepository,
  provider: PaymentProvider,
  order: string | null = null,
) {
  const lease = crypto.randomUUID();
  const mode = config.mode ?? "test";
  const j = await repo.claim(connection, config.account, order, lease, mode);
  if (!j) return;
  try {
    const merchantConfig = paymentAccountConfig(config, j);
    if (!j.session_id && Date.now() - Date.parse(j.created_at) > 20 * 60 * 60 * 1000) {
      await repo.fail(connection, j.id, lease, true);
      return;
    }
    const manual = j.capture_method === "manual";
    const providerJob = providerJobFor(j);
    let session = await provider.session(merchantConfig, providerJob);
    if (!j.session_id) {
      await repo.bind(connection, j.id, lease, session.id);
      providerJob.session_id = session.id;
    }
    const latest = await repo.read(connection, config.account, j.order_id, mode);
    if (!latest) throw new Error("Missing online job");
    paymentAccountConfig(config, latest);
    if (
      session.status === "open" &&
      (latest.close_requested || Date.parse(j.deadline) <= Date.now())
    ) {
      // A concurrent success may make expiration fail. Re-read before deciding anything.
      await provider.expire(merchantConfig, session.id).catch(() => undefined);
      session = await provider.session(merchantConfig, providerJob);
    }
    if (manual && session.authorized) {
      if (!session.intent || !provider.settleAuthorization)
        throw new Error("Manual settlement unavailable");
      const acceptanceDeadline = Date.parse(latest.acceptance_deadline ?? "");
      const requestedAt = Date.parse(latest.capture_requested_at ?? "");
      const closing =
        !!latest.close_requested || ["cancelled", "rejected"].includes(latest.order_status);
      const requestedInTime =
        latest.order_status === "submitted" &&
        Number.isFinite(requestedAt) &&
        requestedAt <= Date.now() &&
        requestedAt < acceptanceDeadline;
      const action =
        requestedInTime && !closing
          ? "capture"
          : closing ||
              Date.now() >=
                (Number.isFinite(acceptanceDeadline) ? acceptanceDeadline : Date.parse(j.deadline))
            ? "cancel"
            : null;
      if (action) {
        await provider.settleAuthorization(
          merchantConfig,
          { id: j.id, intentId: session.intent, amount: j.amount },
          action,
        );
        session = await provider.session(merchantConfig, providerJob);
        if (action === "capture" ? !session.paid : !session.authorizationReleased)
          throw new Error("Settlement not yet confirmed");
      }
    }
    // Completed but unpaid Checkout sessions can still have an asynchronous payment pending.
    // Expire the local reservation at its deadline; any later capture is compensated.
    let state = session.paid
        ? "paid"
        : session.authorized
          ? "authorized"
          : session.authorizationReleased ||
              session.status === "expired" ||
              (session.status === "complete" &&
                (latest.close_requested || Date.parse(j.deadline) <= Date.now()))
            ? "expired"
            : "open",
      refundId = j.refund_id;
    if (
      session.paid &&
      (latest.refund_state !== "none" ||
        latest.close_requested ||
        ["cancelled", "rejected"].includes(latest.order_status))
    ) {
      const refund = await provider.refund(
        merchantConfig,
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
  provider: PaymentProvider,
) {
  const config = paymentConfig(env);
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
  provider: PaymentProvider,
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
  const config = paymentConfig(env);
  if (!config) return fail(503);
  const mode = config.mode ?? "test";
  try {
    const body = await readJsonBody(request);
    if (submit) {
      if (
        (mode === "live"
          ? !liveCheckoutPlatform(env, config)
          : env.ONLINE_PAYMENT_ENABLED !== "true") ||
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
          mode,
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
          mode,
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
        mode,
      ))
    )
      return fail(404);
    let j = await repo.read(env.HYPERDRIVE!.connectionString, config.account, action.orderId, mode);
    if (
      !j ||
      j.restaurant_slug !== scope.restaurantSlug ||
      j.location_slug !== scope.locationSlug ||
      Date.parse(j.deadline) !== Date.parse(action.paymentDeadline)
    )
      return fail(404);
    if (
      !(await repo.resume(env.HYPERDRIVE!.connectionString, config.account, action.orderId, mode))
    )
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
    j = await repo.read(env.HYPERDRIVE!.connectionString, config.account, action.orderId, mode);
    if (!j) return fail(404);
    let url: string | null = null;
    let paymentState = onlineState(j);
    if (j.session_id && paymentState === "open") {
      const session = await provider.session(paymentAccountConfig(config, j), providerJobFor(j));
      if (session.status === "open" && !session.paid) url = session.url;
      else paymentState = "checking";
    }
    const result = parsePaymentSession({ checkoutUrl: url, paymentState }, mode);
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
  provider: PaymentProvider,
) {
  const config = paymentConfig(env);
  if (!config) return jsonError("service_unavailable", "Webhook unavailable.", ctx.requestId, 503);
  const mode = config.mode ?? "test";
  try {
    if (
      new URL(request.url).search ||
      Number(request.headers.get("content-length") ?? 0) > 256 * 1024
    )
      return new Response(null, { status: 400 });
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const value: unknown = chunk.value;
        if (!(value instanceof Uint8Array)) return new Response(null, { status: 400 });
        size += value.byteLength;
        if (size > 256 * 1024) {
          await reader.cancel();
          return new Response(null, { status: 413 });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // Preserve a BOM as a character: stripping it would verify different bytes from the request.
    const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
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
      typeof event.livemode !== "boolean" ||
      (event.account !== undefined &&
        (typeof event.account !== "string" || !/^acct_[A-Za-z0-9]+$/.test(event.account))) ||
      typeof event.id !== "string" ||
      !/^evt_[A-Za-z0-9]+$/.test(event.id)
    )
      return new Response(null, { status: 400 });
    if (mode === "live" && !event.livemode) return new Response(null, { status: 204 });
    if (
      (mode === "test" && event.livemode) ||
      (mode === "live" && (event.account === undefined || event.account === config.account))
    )
      return new Response(null, { status: 400 });
    if (
      typeof event.created !== "number" ||
      !Number.isSafeInteger(event.created) ||
      event.created < 0 ||
      event.created * 1000 > Date.now() + 5 * 60 * 1000
    )
      return new Response(null, { status: 400 });
    if (
      typeof event.type !== "string" ||
      ![
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "checkout.session.expired",
        "payment_intent.amount_capturable_updated",
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
      (value.livemode !== undefined && value.livemode !== (mode === "live")) ||
      !(event.type.startsWith("checkout.session.")
        ? (mode === "live" ? /^cs_live_[A-Za-z0-9]+$/ : /^cs_test_[A-Za-z0-9]+$/).test(value.id)
        : event.type.startsWith("payment_intent.")
          ? /^pi_[A-Za-z0-9]+$/.test(value.id)
          : /^re_[A-Za-z0-9]+$/.test(value.id))
    )
      return new Response(null, { status: 400 });
    // Acknowledge only after durable storage. Raw provider payloads never enter the database.
    const order = await repo.event(
      env.HYPERDRIVE!.connectionString,
      config.account,
      event.id,
      event.type,
      value.id,
      await digest(raw),
      new Date(event.created * 1000).toISOString(),
      typeof event.account === "string" ? event.account : config.account,
      event.type === "payment_intent.succeeded" ||
        event.type === "checkout.session.async_payment_succeeded" ||
        (event.type === "checkout.session.completed" && value.payment_status === "paid"),
      mode,
    );
    if (order) {
      // Storage is durable even if provider reconciliation fails; the cron retries it.
      await processOnlinePayment(env.HYPERDRIVE!.connectionString, config, repo, provider, order);
    }
    return new Response(null, { status: 204 });
  } catch {
    return jsonError("service_unavailable", "Webhook could not be recorded.", ctx.requestId, 503);
  }
}
