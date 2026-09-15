export const appEnvironments = ["development", "test", "preview", "production"] as const;

export type AppEnvironment = (typeof appEnvironments)[number];

export function isAppEnvironment(value: string): value is AppEnvironment {
  return appEnvironments.some((environment) => environment === value);
}

export const apiErrorCodes = [
  "bad_request",
  "conflict",
  "forbidden",
  "internal_error",
  "method_not_allowed",
  "not_found",
  "order_unavailable",
  "payload_too_large",
  "service_unavailable",
  "unauthorized",
  "unsupported_media_type",
] as const;

export type ApiErrorCode = (typeof apiErrorCodes)[number];

export interface ApiErrorEnvelope {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly requestId: string;
  };
}

export interface ApiSuccessEnvelope<T> {
  readonly data: T;
  readonly requestId: string;
}

export * from "./storefront.js";
export * from "./storefront-output.js";
export * from "./checkout.js";
export * from "./order-status.js";
export * from "./dashboard-access.js";
export * from "./dashboard-orders.js";
export * from "./notifications.js";
export * from "./delivery.js";
