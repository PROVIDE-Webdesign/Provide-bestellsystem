import {
  isExplicitInstant,
  isOrderNumber,
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

export function parseEmailStatusFragment(
  fragment: string,
  now = Date.now(),
): StoredOrderStatusAccess | undefined {
  if (fragment.length > 512 || !fragment.startsWith("#")) return undefined;
  const p = new URLSearchParams(fragment.slice(1));
  const keys = ["orderId", "statusAccessToken", "statusAvailableUntil"];
  if (
    [...p.keys()].length !== 3 ||
    keys.some((k) => p.getAll(k).length !== 1) ||
    [...p.keys()].some((k) => !keys.includes(k))
  )
    return undefined;
  return parseStoredOrderStatusAccess(JSON.stringify(Object.fromEntries(p)), now);
}

export interface SavedOrder extends StoredOrderStatusAccess {
  readonly orderNumber?: string;
}

export function readOrderHistory(storage: Storage, key: string, now = Date.now()): SavedOrder[] {
  const historyKey = key + ":history";
  const raw = storage.getItem(historyKey);
  if (!raw) return [];
  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch {
    entries = [];
  }
  const valid: SavedOrder[] = [];
  for (const entry of Array.isArray(entries) ? (entries as unknown[]).slice(0, 20) : []) {
    if (!entry || typeof entry !== "object") continue;
    const { orderNumber, ...access } = entry as Record<string, unknown>;
    const parsed = parseStoredOrderStatusAccess(JSON.stringify(access), now);
    if (parsed && !valid.some((order) => order.orderId === parsed.orderId))
      valid.push({ ...parsed, ...(isOrderNumber(orderNumber) ? { orderNumber } : {}) });
  }
  if (!valid.length) storage.removeItem(historyKey);
  else if (JSON.stringify(valid) !== raw) storage.setItem(historyKey, JSON.stringify(valid));
  return valid;
}

export function saveOrderHistory(storage: Storage, key: string, access: SavedOrder): SavedOrder[] {
  const history = readOrderHistory(storage, key);
  const previous = history.find((order) => order.orderId === access.orderId);
  const orders = [
    { ...previous, ...access },
    ...history.filter((order) => order.orderId !== access.orderId),
  ].slice(0, 20);
  storage.setItem(key + ":history", JSON.stringify(orders));
  return orders;
}
