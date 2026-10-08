import {
  isStorefrontScope,
  CheckoutBodyError,
  checkoutDigest,
  checkoutMac,
  checkoutSubmissionPattern,
  checkoutUuidPattern,
  onlyKeys,
  record,
  parseCheckoutIssue,
  parseCheckoutIntent,
  readCheckoutBody,
  selectionLinesForDatabase,
  validCheckoutSecret,
  verifyCheckoutRequest,
  parseGuestPickupOrderRequest,
  parseGuestDeliveryOrderRequest,
  parseOnlineOrderRequest,
  parseGuestPickupOrderConfirmation,
  parseGuestDeliveryOrderConfirmation,
  parseOnlineOrderConfirmation,
  parsePublicOrderStatusRequest,
  parsePaymentAction,
  type CheckoutAttestation,
  type StorefrontScope,
} from "@provide/contracts";
import type { StorefrontRoute } from "./storefront.js";
import type { RequestContext } from "./context.js";
import { jsonError, jsonSuccess } from "./http.js";
import type { CheckoutWriter } from "./checkout.js";
import type { DeliveryRepository } from "./delivery.js";
import type { OnlineRepository } from "./online-payments-database.js";
import {
  createPaymentToken,
  verifyPaymentToken,
  type OnlineEnvironment,
} from "./online-payments.js";
import {
  createStatusAccessToken,
  hasValidStatusSecret,
  statusAvailableUntil,
  verifyStatusAccessToken,
} from "./status-token.js";
import { checkoutChallengeConfig, type CheckoutChallengeVerifier } from "./checkout-challenge.js";
import type {
  CheckoutProtectionRepository,
  CheckoutBudget,
} from "./checkout-protection-database.js";

export interface CheckoutProtectionEnvironment extends OnlineEnvironment {
  ORDER_STATUS_TOKEN_SECRET_PREVIOUS?: string;
  CHECKOUT_PROTECTION_ENABLED?: string;
  CHECKOUT_GATEWAY_SECRET?: string;
  CHECKOUT_GATEWAY_SECRET_PREVIOUS?: string;
  CHECKOUT_FINGERPRINT_SECRET?: string;
  CHECKOUT_STOREFRONT_ORIGIN?: string;
  CHECKOUT_TURNSTILE_SECRET?: string;
}
export interface ProtectedWriters {
  checkout: CheckoutWriter;
  delivery: DeliveryRepository;
  online: OnlineRepository;
}
export function checkoutProtectionConfigured(env: CheckoutProtectionEnvironment): boolean {
  if (
    env.CHECKOUT_PROTECTION_ENABLED !== "true" ||
    !env.HYPERDRIVE ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true" ||
    !validCheckoutSecret(env.CHECKOUT_GATEWAY_SECRET) ||
    !validCheckoutSecret(env.CHECKOUT_FINGERPRINT_SECRET) ||
    env.CHECKOUT_GATEWAY_SECRET === env.CHECKOUT_FINGERPRINT_SECRET ||
    !hasValidStatusSecret(env.ORDER_STATUS_TOKEN_SECRET)
  )
    return false;
  try {
    const u = new URL(env.CHECKOUT_STOREFRONT_ORIGIN ?? "");
    return (
      u.origin === env.CHECKOUT_STOREFRONT_ORIGIN &&
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !(env.APP_ENV === "production" && ["localhost", "127.0.0.1"].includes(u.hostname))
    );
  } catch {
    return false;
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = record(value);
  if (o)
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function budgets(
  a: CheckoutAttestation,
  group: "issue" | "write" | "read" | "payment",
  primary?: string,
): CheckoutBudget[] {
  const period = group === "issue" ? 600 : 60;
  const capacity = group === "read" ? 600 : 120;
  const result: CheckoutBudget[] = a.network.map((key) => ({
    key: `network:${group}:${key}`,
    capacity,
    period,
  }));
  if (primary)
    result.push({
      key: `primary:${group}:${primary}`,
      capacity: group === "issue" ? 5 : group === "write" ? 6 : group === "payment" ? 20 : 60,
      period,
    });
  return result;
}
async function confirmation(
  raw: unknown,
  mode: string,
  env: CheckoutProtectionEnvironment,
  scope: StorefrontScope,
): Promise<unknown> {
  const o = record(raw);
  if (!o || typeof o.orderId !== "string" || typeof o.requestedFor !== "string")
    throw new Error("Invalid receipt");
  const value = {
    ...o,
    statusAccessToken: await createStatusAccessToken(
      env.ORDER_STATUS_TOKEN_SECRET!,
      scope,
      o.orderId,
    ),
    statusAvailableUntil: statusAvailableUntil(o.requestedFor),
  };
  const result =
    mode === "online-orders"
      ? parseOnlineOrderConfirmation({
          ...value,
          paymentAccessToken: await createPaymentToken(
            env.PAYMENT_ACCESS_SECRET!,
            scope,
            o.orderId,
            String(o.paymentDeadline),
          ),
        })
      : mode === "delivery-orders"
        ? parseGuestDeliveryOrderConfirmation(value)
        : parseGuestPickupOrderConfirmation(value);
  if (!result) throw new Error("Invalid receipt");
  return result;
}
/** Applies to actual public routes; there is no test/legacy write bypass in this dispatcher. */
export async function handleProtectedStorefront(
  request: Request,
  route: StorefrontRoute,
  env: CheckoutProtectionEnvironment,
  repo: CheckoutProtectionRepository,
  challenge: CheckoutChallengeVerifier,
  writers: ProtectedWriters,
  ctx: RequestContext,
  cors: Headers,
  delegate: (request: Request, writers: ProtectedWriters) => Promise<Response>,
): Promise<Response> {
  const fail = (status: number, code: Parameters<typeof jsonError>[0] = "service_unavailable") =>
    jsonError(code, "Checkout request could not be processed.", ctx.requestId, status, cors);
  const isRead = request.method === "GET";
  if (!checkoutProtectionConfigured(env)) {
    // Existing public catalog GETs remain available without a writing session.
    if (
      isRead &&
      env.CHECKOUT_PROTECTION_ENABLED !== "true" &&
      env.CHECKOUT_WRITE_ENABLED !== "true"
    )
      return delegate(request, writers);
    return fail(503);
  }
  if (
    !isStorefrontScope(route) ||
    request.url.length > 2048 ||
    (!isRead && new URL(request.url).search)
  )
    return fail(400, "bad_request");
  const connection = env.HYPERDRIVE!.connectionString;
  try {
    const text = isRead
      ? ""
      : await readCheckoutBody(request, route.name === "checkout-context" ? 1024 : 64 * 1024);
    const a = await verifyCheckoutRequest(request, text, [
      env.CHECKOUT_GATEWAY_SECRET,
      env.CHECKOUT_GATEWAY_SECRET_PREVIOUS,
    ]);
    if (!a || (a.freshContext && route.name !== "checkout-context")) return fail(403, "forbidden");
    const body = isRead ? undefined : record(JSON.parse(text));
    if (!isRead && !body) return fail(400, "bad_request");
    const scopeKey = await checkoutDigest(`${route.restaurantSlug}\n${route.locationSlug}`);
    let group: "issue" | "write" | "read" | "payment" = "read";
    let primary: string | undefined;
    let sessionId: string | undefined;
    let publicCommand: unknown;
    let known: Record<string, unknown> | undefined;
    let fingerprint: string | undefined;
    const isWrite = ["orders", "delivery-orders", "online-orders"].includes(route.name);
    if (route.name === "checkout-context" || route.name === "checkout-session") {
      group = "issue";
      if (a.context && !a.freshContext) primary = await checkoutDigest(`${a.context}:${scopeKey}`);
    } else if (isWrite) {
      if (
        !a.context ||
        !body ||
        !onlyKeys(body, ["sessionId", "command"]) ||
        typeof body.sessionId !== "string" ||
        !checkoutUuidPattern.test(body.sessionId)
      )
        return fail(403, "forbidden");
      sessionId = body.sessionId;
      publicCommand =
        route.name === "orders"
          ? parseGuestPickupOrderRequest(body.command)
          : route.name === "delivery-orders"
            ? parseGuestDeliveryOrderRequest(body.command)
            : parseOnlineOrderRequest(body.command);
      const cmd = record(publicCommand);
      if (!cmd || typeof cmd.submissionKey !== "string") return fail(400, "bad_request");
      fingerprint = await checkoutMac(
        env.CHECKOUT_FINGERPRINT_SECRET!,
        "payload-v1",
        canonical([route.restaurantSlug, route.locationSlug, route.name, publicCommand]),
      );
      known = record(
        await repo.receipt(connection, a.context, sessionId, route, cmd.submissionKey),
      );
      group = known?.outcome === "committed" ? "read" : "write";
      primary = await checkoutDigest(`${a.context}:${sessionId}`);
    } else if (route.name === "checkout-receipt") {
      if (
        !a.context ||
        !body ||
        !onlyKeys(body, ["sessionId", "submissionKey"]) ||
        typeof body.sessionId !== "string" ||
        !checkoutUuidPattern.test(body.sessionId) ||
        typeof body.submissionKey !== "string" ||
        !checkoutSubmissionPattern.test(body.submissionKey)
      )
        return fail(403, "forbidden");
      primary = await checkoutDigest(`${a.context}:${body.sessionId}`);
    } else if (route.name === "orderStatus") {
      const action = parsePublicOrderStatusRequest(body);
      if (
        action &&
        (await verifyStatusAccessToken(
          action.statusAccessToken,
          [env.ORDER_STATUS_TOKEN_SECRET, env.ORDER_STATUS_TOKEN_SECRET_PREVIOUS],
          route,
          action.orderId,
        ))
      )
        primary = await checkoutDigest(action.statusAccessToken);
    } else if (route.name === "payment-session") {
      group = "payment";
      const action = parsePaymentAction(body);
      if (
        action &&
        validCheckoutSecret(env.PAYMENT_ACCESS_SECRET) &&
        (await verifyPaymentToken(
          env.PAYMENT_ACCESS_SECRET,
          route,
          action.orderId,
          action.paymentDeadline,
          action.paymentAccessToken,
        ))
      )
        primary = await checkoutDigest(action.paymentAccessToken);
    } else if (a.context && !a.freshContext)
      primary = await checkoutDigest(`${a.context}:${scopeKey}`);
    const guard = record(await repo.guard(connection, a.nonce, a.at, budgets(a, group, primary)));
    if (
      guard?.outcome === "limited" &&
      typeof guard.retryAfter === "number" &&
      Number.isInteger(guard.retryAfter) &&
      guard.retryAfter >= 1 &&
      guard.retryAfter <= 600
    ) {
      const headers = new Headers(cors);
      headers.set("retry-after", String(guard.retryAfter));
      return jsonError(
        "rate_limited",
        "Please wait before trying again.",
        ctx.requestId,
        429,
        headers,
      );
    }
    if (guard?.outcome !== "allowed")
      return fail(
        guard?.outcome === "forbidden" ? 403 : 503,
        guard?.outcome === "forbidden" ? "forbidden" : "service_unavailable",
      );
    if (route.name === "checkout-context") {
      if (!a.context || !body || !onlyKeys(body, [])) return fail(400, "bad_request");
      const result = record(await repo.context(connection, a.context, a.freshContext));
      return result?.outcome === "allowed"
        ? jsonSuccess(
            { ready: true, contextExpiresAt: result.contextExpiresAt },
            ctx.requestId,
            200,
            cors,
          )
        : fail(
            result?.outcome === "expired" ? 410 : 503,
            result?.outcome === "expired" ? "checkout_session_expired" : "service_unavailable",
          );
    }
    if (route.name === "checkout-session") {
      if (!a.context || env.CHECKOUT_WRITE_ENABLED !== "true") return fail(503);
      const issue = parseCheckoutIssue(body);
      if (!issue) return fail(400, "bad_request");
      const config = checkoutChallengeConfig(env);
      if (!config) return fail(503);
      const ch = await checkoutDigest(issue.challenge);
      const binding = await checkoutMac(
        env.CHECKOUT_FINGERPRINT_SECRET!,
        "issue-v1",
        canonical([
          a.context,
          route.restaurantSlug,
          route.locationSlug,
          issue.issueId,
          issue.submissionKey,
          issue.renewSessionId ?? null,
        ]),
      );
      const claim = record(await repo.beginIssue(connection, ch, issue, binding, a.context));
      if (claim?.outcome === "issued") {
        const intent = parseCheckoutIntent(claim.intent);
        return intent ? jsonSuccess(intent, ctx.requestId, 200, cors) : fail(503);
      }
      if (claim?.outcome !== "pending")
        return fail(
          claim?.outcome === "unavailable" ? 503 : 403,
          claim?.outcome === "unavailable" ? "service_unavailable" : "forbidden",
        );
      // Transport uncertainty leaves the same pending provider UUID available for an explicit retry.
      const valid = await challenge.verify(config, issue.challenge, issue.issueId);
      const result = record(
        await repo.finishIssue(connection, ch, issue, binding, a.context, route, valid),
      );
      const intent = parseCheckoutIntent(result?.intent);
      return result?.outcome === "issued" && intent
        ? jsonSuccess(intent, ctx.requestId, 201, cors)
        : fail(
            result?.outcome === "unavailable" ? 503 : 409,
            result?.outcome === "unavailable" ? "service_unavailable" : "conflict",
          );
    }
    if (route.name === "checkout-receipt") {
      const result = record(
        await repo.receipt(
          connection,
          a.context!,
          String(body!.sessionId),
          route,
          String(body!.submissionKey),
        ),
      );
      if (result?.outcome === "committed")
        return jsonSuccess(
          {
            state: "committed",
            mode: result.mode,
            confirmation: await confirmation(result.receipt, String(result.mode), env, route),
          },
          ctx.requestId,
          200,
          cors,
        );
      if (result?.outcome === "unsubmitted")
        return jsonSuccess(
          { state: "unsubmitted", writeExpired: result.writeExpired === true },
          ctx.requestId,
          200,
          cors,
        );
      return fail(410, "checkout_session_expired");
    }
    if (isWrite) {
      if (known?.outcome === "committed") {
        if (known.fingerprint !== fingerprint || known.mode !== route.name)
          return fail(409, "conflict");
        return jsonSuccess(
          await confirmation(known.receipt, route.name, env, route),
          ctx.requestId,
          200,
          cors,
        );
      }
      if (known?.writeExpired === true) return fail(410, "checkout_session_expired");
      if (known?.outcome !== "unsubmitted")
        return fail(
          known?.outcome === "expired" ? 410 : 403,
          known?.outcome === "expired" ? "checkout_session_expired" : "forbidden",
        );
      const submit = (retention: number, account: string | null = null) => {
        const c = record(publicCommand)!;
        const customer = record(c.customer)!;
        const d = record(c.delivery);
        const command = {
          ...c,
          lines: selectionLinesForDatabase(
            c.lines as Parameters<typeof selectionLinesForDatabase>[0],
          ),
          customer: {
            contact_name: customer.contactName,
            phone_e164: customer.phoneE164,
            email: customer.email,
          },
          ...(d
            ? {
                delivery: {
                  address_line_1: d.addressLine1,
                  address_line_2: d.addressLine2,
                  postal_code: d.postalCode,
                  city: d.city,
                  country_code: d.countryCode,
                },
              }
            : {}),
        };
        return repo.submit(
          connection,
          a.context!,
          sessionId!,
          route,
          route.name,
          fingerprint!,
          command,
          retention,
          account,
        );
      };
      const protectedWriters: ProtectedWriters = {
        checkout: { submit: (_c, _command, retention) => submit(retention) },
        delivery: {
          quote: writers.delivery.quote,
          submit: (_c, _s, _command, retention) => submit(retention),
        },
        online: {
          ...writers.online,
          submit: (_c, _s, _command, retention, account) => submit(retention, account),
        },
      };
      const downstream = new Request(request.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(publicCommand),
      });
      const result = await delegate(downstream, protectedWriters);
      // A transport/database failure after submission cannot prove that no order committed.
      if (result.status >= 500) return fail(503, "checkout_result_unknown");
      return result;
    }
    const downstream = isRead
      ? request
      : new Request(request.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: text,
        });
    return delegate(downstream, writers);
  } catch (error) {
    if (error instanceof CheckoutBodyError)
      return fail(
        error.status,
        error.status === 413
          ? "payload_too_large"
          : error.status === 415
            ? "unsupported_media_type"
            : "bad_request",
      );
    // No raw exception or request material is logged or exposed at this boundary.
    return fail(503);
  }
}
