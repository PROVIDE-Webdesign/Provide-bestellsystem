import { isStorefrontScope, type StorefrontScope } from "@provide/contracts";

export function favoritesKey(scope: StorefrontScope): string | undefined {
  return isStorefrontScope(scope)
    ? `provide:favorites:v1:${scope.restaurantSlug}:${scope.locationSlug}`
    : undefined;
}

export function parseFavorites(raw: string | null): string[] {
  if (!raw || raw.length > 16000) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (id): id is string => typeof id === "string" && /^[a-zA-Z0-9:_-]{1,100}$/.test(id),
            ),
          ),
        ].slice(0, 100)
      : [];
  } catch {
    return [];
  }
}
