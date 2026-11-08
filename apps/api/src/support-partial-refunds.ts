import { Client } from "pg";
import type { SupportRefundCommand } from "@provide/contracts";
import { createRequestContext } from "./context.js";
import type { DashboardIdentity } from "./dashboard-auth.js";
import type { ApiLogger } from "./logger.js";
import { sandboxConfig, type OnlineEnvironment } from "./online-payments.js";
import { digest, stripeTestPartialRefund, type SupportRefundJob } from "./stripe-sandbox.js";

export interface SupportRefundEnvironment extends Partial<OnlineEnvironment> {
  SUPPORT_CASES_ENABLED?: string;
  SUPPORT_TEST_REFUNDS_ENABLED?: string;
}

function refundConfig(env: SupportRefundEnvironment) {
  if (
    env.SUPPORT_CASES_ENABLED !== "true" ||
    env.SUPPORT_TEST_REFUNDS_ENABLED !== "true" ||
    !env.APP_ENV ||
    env.APP_ENV === "production" ||
    !env.HYPERDRIVE ||
    env.HYPERDRIVE_CACHE_DISABLED !== "true"
  )
    return;
  const stripe = sandboxConfig({ ...env, APP_ENV: env.APP_ENV });
  if (stripe) return { stripe, connection: env.HYPERDRIVE.connectionString };
}

async function query<T>(connection: string, sql: string, args: unknown[]) {
  const client = new Client({
    connectionString: connection,
    connectionTimeoutMillis: 5000,
    query_timeout: 7000,
  });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    await client.query("SET LOCAL statement_timeout='5s'");
    const result = await client.query<{ data: T }>(sql, args);
    await client.query("COMMIT");
    return result.rows[0]?.data;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function requestSupportPartialRefund(
  env: SupportRefundEnvironment,
  actor: DashboardIdentity,
  q: SupportRefundCommand,
) {
  const config = refundConfig(env);
  if (!config) return { outcome: "unavailable" };
  return query<{ outcome: string; data?: unknown }>(
    config.connection,
    "select private.request_support_partial_refund($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as data",
    [
      actor.userId,
      actor.sessionId,
      actor.aal,
      q.restaurantId,
      q.locationId,
      q.caseId,
      q.requestId,
      q.amountMinor,
      q.reason,
      config.stripe.account,
    ],
  );
}

export async function dispatchSupportPartialRefunds(
  env: SupportRefundEnvironment,
  logger: ApiLogger,
  provider = stripeTestPartialRefund,
) {
  const config = refundConfig(env);
  if (!config) return;
  const context = createRequestContext();
  try {
    for (let i = 0; i < 3; i++) {
      const lease = crypto.randomUUID();
      const job = await query<SupportRefundJob | { review: true } | null>(
        config.connection,
        "select private.claim_support_partial_refund($1,$2) as data",
        [config.stripe.account, lease],
      );
      if (!job) return;
      if ("review" in job) {
        logger.error(context, "support_test_refund_review_required");
        continue;
      }
      const refund = await provider(config.stripe, job).catch(() => undefined);
      const result = await query<string>(
        config.connection,
        "select private.finish_support_partial_refund($1,$2,$3,$4,$5) as data",
        [
          job.id,
          lease,
          refund?.status ?? "unknown",
          refund?.id ?? null,
          refund
            ? await digest(
                JSON.stringify({ id: refund.id, status: refund.status, amount: job.amount }),
              )
            : null,
        ],
      );
      if (result !== "succeeded" && result !== "pending")
        logger.error(context, "support_test_refund_" + (result ?? "unknown"));
    }
  } catch {
    logger.error(context, "support_test_refund_processing_failed");
  }
}
