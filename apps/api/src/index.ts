import { handleAccountRecovery } from "./account-recovery.js";
import {
  handleProvideAdmin,
  postgresProvideAdmin,
  type ProvideAdminRepository,
} from "./provide-admin.js";
import {
  handleLocationOperations,
  postgresLocationOperations,
  type LocationOperationsRepository,
} from "./location-operations.js";
import { handleMenuAdmin, postgresMenuAdmin, type MenuAdminRepository } from "./menu-admin.js";
import { dispatchAcceptanceAlerts } from "./order-alerts.js";
import { handleCartQuote, postgresCartQuoteReader, type CartQuoteReader } from "./cart-quote.js";
import { handleDelivery, type DeliveryRepository } from "./delivery.js";
import {
  handleOnlinePayment,
  handleStripeWebhook,
  dispatchOnlinePayments,
  type OnlineEnvironment,
} from "./online-payments.js";
import { postgresOnlineRepository, type OnlineRepository } from "./online-payments-database.js";
import { stripeSandboxProvider, type SandboxProvider } from "./stripe-sandbox.js";
import { postgresDeliveryRepository } from "./delivery-database.js";
import { isAppEnvironment } from "@provide/contracts";

import { corsHeaders, parseAllowedOrigins } from "./cors.js";
import { createRequestContext } from "./context.js";
import { handleGuestPickupOrder, type CheckoutWriter } from "./checkout.js";
import { postgresCheckoutWriter } from "./checkout-database.js";
import { handleStorefront, type StorefrontReader } from "./storefront.js";
import { postgresStorefrontReader } from "./storefront-database.js";
import { probeDatabase } from "./database.js";
import { handlePublicOrderStatus, type OrderStatusReader } from "./order-status.js";
import { postgresOrderStatusReader } from "./order-status-database.js";
import { handleDashboardAccess, type DashboardAccessReader } from "./dashboard-access.js";
import { postgresDashboardAccessReader } from "./dashboard-access-database.js";
import { supabaseDashboardTokenVerifier, type DashboardTokenVerifier } from "./dashboard-auth.js";
import { handleDashboardOrders, type DashboardOrdersReader } from "./dashboard-orders.js";
import { postgresDashboardOrdersReader } from "./dashboard-orders-database.js";
import { jsonError, jsonSuccess } from "./http.js";
import { consoleLogger, type ApiLogger } from "./logger.js";
import {
  dispatchOrderNotifications,
  type NotificationAdapter,
  type NotificationRepository,
  unconfiguredNotificationAdapter,
} from "./notifications.js";
import { postgresNotificationRepository } from "./notifications-database.js";
import { isKnownPath, routeRequest } from "./router.js";
import {
  dispatchEmailNotifications,
  unconfiguredEmailAdapter,
  type EmailAdapter,
  type EmailRepository,
} from "./email-notifications.js";
import { postgresEmailRepository } from "./email-notifications-database.js";

interface HyperdriveBinding {
  readonly connectionString: string;
}

interface Env extends OnlineEnvironment {
  readonly ACCOUNT_RECOVERY_ENABLED?: string;
  readonly ACCOUNT_RECOVERY_ORIGIN?: string;
  readonly DASHBOARD_PERSONNEL_ENABLED?: string;
  readonly PERSONNEL_INVITATIONS_ENABLED?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly PERSONNEL_DASHBOARD_ORIGIN?: string;
  readonly PROVIDE_ADMIN_ENABLED?: string;
  readonly PROVIDE_ADMIN_LIVE_ENABLED?: string;
  readonly DASHBOARD_HISTORY_ENABLED?: string;
  readonly GUEST_RETENTION_PURGE_ENABLED?: string;
  readonly DASHBOARD_ORDER_ALERTS_ENABLED?: string;
  readonly DASHBOARD_LOCATION_OPERATIONS_ENABLED?: string;
  readonly DASHBOARD_MENU_ENABLED?: string;
  readonly CART_QUOTE_ENABLED?: string;
  readonly DELIVERY_ORDERING_ENABLED?: string;
  readonly APP_ENV: string;
  readonly API_ALLOWED_ORIGINS?: string;
  readonly CHECKOUT_WRITE_ENABLED?: string;
  readonly CHECKOUT_PRIVACY_NOTICE_VERSION?: string;
  readonly CHECKOUT_RETENTION_DAYS?: string;
  readonly ORDER_STATUS_READ_ENABLED?: string;
  readonly ORDER_STATUS_TOKEN_SECRET?: string;
  readonly ORDER_STATUS_TOKEN_SECRET_PREVIOUS?: string;
  readonly DASHBOARD_AUTH_ENABLED?: string;
  readonly DASHBOARD_ORDER_OPERATIONS_ENABLED?: string;
  readonly NOTIFICATION_DISPATCH_ENABLED?: string;
  readonly EMAIL_DISPATCH_ENABLED?: string;
  readonly EMAIL_STOREFRONT_ORIGIN?: string;
  readonly SUPABASE_AUTH_ISSUER?: string;
  readonly SUPABASE_AUTH_AUDIENCE?: string;
  readonly HYPERDRIVE_CACHE_DISABLED?: string;
  readonly HYPERDRIVE?: HyperdriveBinding;
}

type DatabaseProbe = (connectionString: string) => Promise<void>;

export function createApiWorker(
  databaseProbe: DatabaseProbe = probeDatabase,
  logger: ApiLogger = consoleLogger,
  storefrontReader: StorefrontReader = postgresStorefrontReader,
  checkoutWriter: CheckoutWriter = postgresCheckoutWriter,
  orderStatusReader: OrderStatusReader = postgresOrderStatusReader,
  dashboardTokenVerifier: DashboardTokenVerifier = supabaseDashboardTokenVerifier,
  dashboardAccessReader: DashboardAccessReader = postgresDashboardAccessReader,
  dashboardOrdersReader: DashboardOrdersReader = postgresDashboardOrdersReader,
  notificationRepository: NotificationRepository = postgresNotificationRepository,
  notificationAdapter: NotificationAdapter = unconfiguredNotificationAdapter,
  deliveryRepository: DeliveryRepository = postgresDeliveryRepository,
  onlineRepository: OnlineRepository = postgresOnlineRepository,
  onlineProvider: SandboxProvider = stripeSandboxProvider,
  emailRepository: EmailRepository = postgresEmailRepository,
  emailAdapter: EmailAdapter = unconfiguredEmailAdapter,
  cartQuoteReader: CartQuoteReader = postgresCartQuoteReader,
  menuAdmin: MenuAdminRepository = postgresMenuAdmin,
  locationOperations: LocationOperationsRepository = postgresLocationOperations,
  historyRepository: HistoryRepository = postgresHistory,
  guestPurge: typeof postgresGuestPurge = postgresGuestPurge,
  provideAdmin: ProvideAdminRepository = postgresProvideAdmin,
  personnel: PersonnelRepository = postgresPersonnel,
  inviteProvider: PersonnelInviteProvider = supabasePersonnelInvite,
) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const context = createRequestContext();
      const cors = corsHeaders(request, parseAllowedOrigins(env.API_ALLOWED_ORIGINS));
      const environment = isAppEnvironment(env.APP_ENV) ? env.APP_ENV : "unknown";

      if (request.method === "OPTIONS") {
        return new Response(null, { headers: cors, status: 204 });
      }

      const route = routeRequest(request);
      if (!route) {
        if (isKnownPath(request)) {
          return jsonError(
            "method_not_allowed",
            "Method is not allowed for this resource.",
            context.requestId,
            405,
            cors,
          );
        }
        return jsonError("not_found", "Resource was not found.", context.requestId, 404, cors);
      }

      if (route.name === "accountRecovery")
        return handleAccountRecovery(request, env, dashboardTokenVerifier, context, logger, cors);
      if (route.name === "personnel")
        return handlePersonnel(
          request,
          env,
          dashboardTokenVerifier,
          personnel,
          inviteProvider,
          context,
          logger,
          cors,
        );
      if (route.name === "provideAdmin")
        return handleProvideAdmin(
          request,
          env,
          dashboardTokenVerifier,
          provideAdmin,
          context,
          logger,
          cors,
        );
      if (route.name === "dashboardHistory")
        return handleOrderHistory(
          request,
          route,
          env,
          dashboardTokenVerifier,
          historyRepository,
          context,
          logger,
          cors,
        );
      if (route.name === "dashboardLocationOperations")
        return handleLocationOperations(
          request,
          route,
          env,
          dashboardTokenVerifier,
          locationOperations,
          context,
          logger,
          cors,
        );
      if (route.name === "dashboardMenu")
        return handleMenuAdmin(
          request,
          route,
          env,
          dashboardTokenVerifier,
          menuAdmin,
          context,
          logger,
          cors,
        );
      if (route.name === "cart-quote")
        return handleCartQuote(request, route, env, cartQuoteReader, context, logger, cors);
      if (route.name === "delivery-quote" || route.name === "delivery-orders") {
        return handleDelivery(
          request,
          route,
          route.name === "delivery-quote",
          env,
          deliveryRepository,
          context,
          logger,
          cors,
        );
      }
      if (route.name === "stripeWebhook")
        return handleStripeWebhook(request, env, onlineRepository, context, onlineProvider);
      if (route.name === "online-orders" || route.name === "payment-session")
        return handleOnlinePayment(
          request,
          route,
          route.name === "online-orders",
          env,
          onlineRepository,
          onlineProvider,
          context,
          cors,
        );
      if (route.name === "orders") {
        return handleGuestPickupOrder(request, route, env, checkoutWriter, context, logger, cors);
      }

      if (route.name === "orderStatus") {
        return handlePublicOrderStatus(
          request,
          route,
          env,
          orderStatusReader,
          context,
          logger,
          cors,
        );
      }

      if (route.name === "dashboardAccess") {
        return handleDashboardAccess(
          request,
          env,
          dashboardTokenVerifier,
          dashboardAccessReader,
          context,
          logger,
          cors,
        );
      }

      if (
        route.name === "dashboardOrders" ||
        route.name === "dashboardOrderAlerts" ||
        route.name === "dashboardOrder" ||
        route.name === "dashboardOrderStatus" ||
        route.name === "dashboardRefundRetry" ||
        route.name === "dashboardOrderCommunication"
      ) {
        return handleDashboardOrders(
          request,
          route,
          env,
          dashboardTokenVerifier,
          dashboardOrdersReader,
          context,
          logger,
          cors,
        );
      }

      if (route.name === "catalog" || route.name === "availability") {
        return handleStorefront(request, route, env, storefrontReader, context, logger, cors);
      }

      if (route.name === "health") {
        return jsonSuccess(
          {
            application: "api",
            database: env.HYPERDRIVE ? "configured" : "not-configured",
            environment,
            runtime: "cloudflare-workers",
            status: "ok",
          },
          context.requestId,
          200,
          cors,
        );
      }

      if (!env.HYPERDRIVE) {
        return jsonError(
          "service_unavailable",
          "Database health probe is not available.",
          context.requestId,
          503,
          cors,
        );
      }

      try {
        await databaseProbe(env.HYPERDRIVE.connectionString);
        return jsonSuccess({ database: "reachable", status: "ok" }, context.requestId, 200, cors);
      } catch {
        logger.error(context, "database_health_probe_failed");
        return jsonError(
          "service_unavailable",
          "Database health probe is not available.",
          context.requestId,
          503,
          cors,
        );
      }
    },
    scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
      context.waitUntil(dispatchGuestPurge(env, logger, guestPurge));
      context.waitUntil(dispatchAcceptanceAlerts(env, dashboardOrdersReader, logger));
      context.waitUntil(dispatchOnlinePayments(env, onlineRepository, onlineProvider));
      context.waitUntil(dispatchEmailNotifications(env, emailRepository, emailAdapter, logger));
      context.waitUntil(
        dispatchOrderNotifications(env, notificationRepository, notificationAdapter, logger),
      );
    },
  };
}

export default createApiWorker() satisfies ExportedHandler<Env>;
import {
  handleOrderHistory,
  postgresHistory,
  dispatchGuestPurge,
  postgresGuestPurge,
  type HistoryRepository,
} from "./order-history.js";
import {
  handlePersonnel,
  postgresPersonnel,
  supabasePersonnelInvite,
  type PersonnelRepository,
  type PersonnelInviteProvider,
} from "./personnel.js";
