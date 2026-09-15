import {
  isExplicitInstant,
  isStorefrontScope,
  parsePublicOrderStatusRequest,
  type PublicOrderStatusRequest,
  type StorefrontScope,
} from "@provide/contracts";

export interface StoredOrderStatusAccess extends PublicOrderStatusRequest {
  readonly statusAvailableUntil: string;
}

export function orderStatusStorageKey(scope: StorefrontScope): string | undefined {
  if (!isStorefrontScope(scope)) return undefined;
  return `provide:order-status:v1:${scope.restaurantSlug}:${scope.locationSlug}`;
}

export function parseStoredOrderStatusAccess(
  value: string | null,
  now = Date.now(),
): StoredOrderStatusAccess | undefined {
  if (!value) return undefined;
  try {
    const source = JSON.parse(value) as Record<string, unknown>;
    if (
      Object.keys(source).length !== 3 ||
      typeof source.statusAvailableUntil !== "string" ||
      !isExplicitInstant(source.statusAvailableUntil) ||
      Date.parse(source.statusAvailableUntil) <= now
    )
      return undefined;
    const access = parsePublicOrderStatusRequest({
      orderId: source.orderId,
      statusAccessToken: source.statusAccessToken,
    });
    return access ? { ...access, statusAvailableUntil: source.statusAvailableUntil } : undefined;
  } catch {
    return undefined;
  }
}
