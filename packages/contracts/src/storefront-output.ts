import type { PublicAvailability, PublicCatalog } from "./storefront.js";
import { isExplicitInstant } from "./storefront.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid public response");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid public response");
  return value;
}
function nullable(value: unknown): string | null {
  return value === null ? null : string(value);
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid public response");
  return value as unknown[];
}
function id(value: unknown): string {
  const result = string(value);
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(result))
    throw new Error("Invalid public response");
  return result;
}

/** Reconstructs the public allowlist; extra fields from any upstream are never forwarded. */
export function parsePublicCatalog(value: unknown): PublicCatalog {
  const source = object(value),
    restaurant = object(source.restaurant),
    location = object(source.location);
  const address = object(location.address);
  const timezone = string(location.timezone);
  new Intl.DateTimeFormat("de-DE", { timeZone: timezone }).format();
  return {
    restaurant: { slug: string(restaurant.slug), name: string(restaurant.name) },
    location: {
      slug: string(location.slug),
      name: string(location.name),
      timezone,
      address: {
        line1: string(address.line1),
        line2: nullable(address.line2),
        postalCode: string(address.postalCode),
        city: string(address.city),
        countryCode: string(address.countryCode),
      },
    },
    menus: array(source.menus).map((value) => {
      const menu = object(value);
      const currency = string(menu.currency);
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid public response");
      return {
        id: id(menu.id),
        versionId: id(menu.versionId),
        name: string(menu.name),
        currency,
        sections: array(menu.sections).map((value) => {
          const section = object(value);
          return {
            key: string(section.key),
            name: string(section.name),
            items: array(section.items).map((value) => {
              const item = object(value);
              const price = item.priceAmountMinor,
                availability = item.availability;
              if (
                typeof price !== "number" ||
                !Number.isSafeInteger(price) ||
                price < 0 ||
                price > 1_000_000_000 ||
                (availability !== "available" &&
                  availability !== "sold_out" &&
                  availability !== "unavailable")
              )
                throw new Error("Invalid public response");
              return {
                id: id(item.id),
                name: string(item.name),
                description: nullable(item.description),
                priceAmountMinor: price,
                availability,
              };
            }),
          };
        }),
      };
    }),
  };
}

export function parsePublicAvailability(value: unknown): PublicAvailability {
  const source = object(value);
  const { status, fulfillmentType, itemCount } = source;
  const requestedFor = string(source.requestedFor),
    evaluatedAt = string(source.evaluatedAt);
  if (
    (status !== "available" && status !== "unavailable") ||
    (fulfillmentType !== "pickup" && fulfillmentType !== "delivery") ||
    typeof itemCount !== "number" ||
    !Number.isInteger(itemCount) ||
    itemCount < 1 ||
    itemCount > 1000 ||
    !isExplicitInstant(requestedFor) ||
    !isExplicitInstant(evaluatedAt)
  )
    throw new Error("Invalid public response");
  return { status, fulfillmentType, itemCount, requestedFor, evaluatedAt };
}
