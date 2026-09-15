export const fulfillmentTypes = ["pickup", "delivery"] as const;
export type FulfillmentType = (typeof fulfillmentTypes)[number];
export type ItemAvailability = "available" | "sold_out" | "unavailable";

export interface StorefrontScope {
  readonly restaurantSlug: string;
  readonly locationSlug: string;
}
export interface AvailabilityQuery extends StorefrontScope {
  readonly fulfillmentType: FulfillmentType;
  /** UTC instant with an explicit offset, never a browser-local wall clock. */
  readonly requestedFor: string;
  readonly itemCount: number;
}
export interface PublicCatalog {
  readonly restaurant: { readonly slug: string; readonly name: string };
  readonly location: {
    readonly slug: string;
    readonly name: string;
    readonly timezone: string;
    readonly address: {
      readonly line1: string;
      readonly line2: string | null;
      readonly postalCode: string;
      readonly city: string;
      readonly countryCode: string;
    };
  };
  readonly menus: readonly {
    readonly id: string;
    readonly versionId: string;
    readonly name: string;
    readonly currency: string;
    readonly sections: readonly {
      readonly key: string;
      readonly name: string;
      readonly items: readonly {
        readonly id: string;
        readonly name: string;
        readonly description: string | null;
        readonly priceAmountMinor: number;
        readonly availability: ItemAvailability;
      }[];
    }[];
  }[];
}
export interface PublicAvailability {
  readonly status: "available" | "unavailable";
  readonly fulfillmentType: FulfillmentType;
  readonly requestedFor: string;
  readonly itemCount: number;
  readonly evaluatedAt: string;
}

export function isStorefrontScope(value: StorefrontScope): boolean {
  const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  return (
    value.restaurantSlug.length >= 3 &&
    value.restaurantSlug.length <= 63 &&
    value.locationSlug.length >= 2 &&
    value.locationSlug.length <= 63 &&
    slug.test(value.restaurantSlug) &&
    slug.test(value.locationSlug)
  );
}

/** Strict RFC3339 subset: seconds required; Z or a numeric offset required. */
export function isExplicitInstant(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return false;
  const [, year, month, day, hour, minute, second, offset] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return (
    Number(year) >= 2000 &&
    Number(year) <= 9999 &&
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= days &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    (offset === "Z" ||
      (Number(offset?.slice(1, 3)) <= 14 &&
        Number(offset?.slice(4, 6)) <= 59 &&
        (Number(offset?.slice(1, 3)) < 14 || Number(offset?.slice(4, 6)) === 0))) &&
    Number.isFinite(Date.parse(value))
  );
}

export function isAvailabilityQuery(value: AvailabilityQuery): boolean {
  return (
    isStorefrontScope(value) &&
    fulfillmentTypes.includes(value.fulfillmentType) &&
    isExplicitInstant(value.requestedFor) &&
    Number.isInteger(value.itemCount) &&
    value.itemCount >= 1 &&
    value.itemCount <= 1000
  );
}
