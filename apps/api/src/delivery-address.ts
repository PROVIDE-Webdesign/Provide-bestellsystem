import { readCheckoutBody, record, type DeliveryAddress } from "@provide/contracts";

export interface DeliveryAddressEnvironment {
  readonly APP_ENV?: string;
  readonly DELIVERY_ORDERING_ENABLED?: string;
  readonly DELIVERY_ADDRESS_VALIDATION_ENABLED?: string;
  readonly GOOGLE_ADDRESS_VALIDATION_API_KEY?: string;
}

export type DeliveryAddressIssue =
  | "delivery_address_incomplete"
  | "delivery_address_ambiguous"
  | "delivery_address_unverified"
  | "delivery_address_unavailable";

type AddressResult =
  | {
      readonly status: "verified";
      readonly address: DeliveryAddress;
      readonly latitude: number;
      readonly longitude: number;
    }
  | { readonly status: DeliveryAddressIssue };

// Hosted environments require verification whenever delivery is offered.
export function requiresDeliveryAddressValidation(env: DeliveryAddressEnvironment): boolean {
  return (
    env.DELIVERY_ADDRESS_VALIDATION_ENABLED === "true" ||
    env.APP_ENV === "preview" ||
    env.APP_ENV === "production"
  );
}

const propertyPrecision = new Set(["PREMISE", "SUB_PREMISE"]);
const present = (v: unknown): v is string =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  [...v].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127);
const nonemptyList = (v: unknown) => Array.isArray(v) && v.length > 0;
const coordinate = (v: unknown, limit: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;

function interpretGoogleResult(raw: unknown, input: DeliveryAddress): AddressResult {
  const result = record(record(raw)?.result);
  const verdict = record(result?.verdict);
  const address = record(result?.address);
  if (!verdict || !address) return { status: "delivery_address_unavailable" };
  if (nonemptyList(address.missingComponentTypes)) return { status: "delivery_address_incomplete" };
  if (
    verdict.possibleNextAction === "CONFIRM" ||
    verdict.possibleNextAction === "CONFIRM_ADD_SUBPREMISES" ||
    verdict.hasReplacedComponents === true ||
    verdict.hasInferredComponents === true ||
    nonemptyList(address.unresolvedTokens)
  )
    return { status: "delivery_address_ambiguous" };
  if (
    verdict.addressComplete !== true ||
    verdict.hasUnconfirmedComponents === true ||
    nonemptyList(address.unconfirmedComponentTypes) ||
    (verdict.possibleNextAction !== undefined && verdict.possibleNextAction !== "ACCEPT") ||
    !propertyPrecision.has(String(verdict.validationGranularity)) ||
    !propertyPrecision.has(String(verdict.geocodeGranularity))
  )
    return { status: "delivery_address_unverified" };
  const components = Array.isArray(address.addressComponents)
    ? address.addressComponents.map(record)
    : [];
  if (
    !["route", "street_number"].every((type) =>
      components.some((c) => c?.componentType === type && c.confirmationLevel === "CONFIRMED"),
    )
  )
    return { status: "delivery_address_unverified" };
  const postal = record(address.postalAddress);
  const line: unknown = Array.isArray(postal?.addressLines) ? postal.addressLines[0] : undefined;
  const location = record(record(result?.geocode)?.location);
  if (!postal || !present(line) || !present(postal.locality))
    return { status: "delivery_address_unverified" };
  if (postal.regionCode !== input.countryCode || postal.postalCode !== input.postalCode)
    return { status: "delivery_address_ambiguous" };
  if (!coordinate(location?.latitude, 90) || !coordinate(location?.longitude, 180))
    return { status: "delivery_address_unverified" };
  return {
    status: "verified",
    address: { ...input, addressLine1: line, city: postal.locality },
    latitude: location.latitude,
    longitude: location.longitude,
  };
}

export async function verifyDeliveryAddress(
  env: DeliveryAddressEnvironment,
  address: DeliveryAddress | undefined,
  fetcher: typeof fetch = fetch,
): Promise<AddressResult> {
  if (
    !address ||
    !present(address.addressLine1) ||
    !/\d/u.test(address.addressLine1) ||
    !present(address.city) ||
    !/^[0-9]{5}$/.test(address.postalCode) ||
    [...address.addressLine1, ...address.city].length + address.postalCode.length + 2 > 280
  )
    return { status: "delivery_address_incomplete" };
  const key = env.GOOGLE_ADDRESS_VALIDATION_API_KEY;
  if (!key || !/^[A-Za-z0-9_-]{20,128}$/.test(key))
    return { status: "delivery_address_unavailable" };
  try {
    const signal = AbortSignal.timeout(2500);
    const response = await fetcher("https://addressvalidation.googleapis.com/v1:validateAddress", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        address: {
          regionCode: address.countryCode,
          postalCode: address.postalCode,
          locality: address.city,
          addressLines: [address.addressLine1],
        },
      }),
      redirect: "manual",
      signal,
    });
    if (!response.ok) return { status: "delivery_address_unavailable" };
    return interpretGoogleResult(JSON.parse(await readCheckoutBody(response, 64 * 1024)), address);
  } catch {
    return { status: "delivery_address_unavailable" };
  }
}

export const deliveryAddressIssueStatus = (issue: DeliveryAddressIssue): 422 | 503 =>
  issue === "delivery_address_unavailable" ? 503 : 422;
