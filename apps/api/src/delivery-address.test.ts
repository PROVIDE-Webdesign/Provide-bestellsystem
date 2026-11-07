import { describe, expect, it, vi } from "vitest";
import google from "../../../fixtures/delivery-address-validation.json" with { type: "json" };
import { requiresDeliveryAddressValidation, verifyDeliveryAddress } from "./delivery-address.js";

const input = {
  addressLine1: "testweg 10",
  addressLine2: "Private delivery instructions",
  postalCode: "52062",
  city: "Teststadt",
  countryCode: "DE" as const,
};
const env = { GOOGLE_ADDRESS_VALIDATION_API_KEY: "synthetic-geocoding-key" };
const result = google.result;

describe("Google address validation adapter", () => {
  it("normalizes a premise and returns coordinates, sending only address fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(google));
    await expect(verifyDeliveryAddress(env, input, fetcher)).resolves.toEqual({
      status: "verified",
      address: { ...input, addressLine1: "Testweg 10" },
      latitude: 50.75,
      longitude: 6.08,
    });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://addressvalidation.googleapis.com/v1:validateAddress");
    expect(options?.redirect).toBe("manual");
    expect(new Headers(options?.headers).get("x-goog-api-key")).toBe(
      env.GOOGLE_ADDRESS_VALIDATION_API_KEY,
    );
    if (typeof options?.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(options.body)).toEqual({
      address: {
        regionCode: "DE",
        postalCode: "52062",
        locality: "Teststadt",
        addressLines: ["testweg 10"],
      },
    });
  });
  it.each([undefined, { ...input, addressLine1: "Testweg" }, { ...input, city: " " }])(
    "rejects incomplete input before the provider call",
    async (address) => {
      const fetcher = vi.fn<typeof fetch>();
      expect(await verifyDeliveryAddress(env, address, fetcher)).toEqual({
        status: "delivery_address_incomplete",
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([
    [
      "delivery_address_incomplete",
      { ...result, address: { ...result.address, missingComponentTypes: ["street_number"] } },
    ],
    [
      "delivery_address_ambiguous",
      { ...result, verdict: { ...result.verdict, possibleNextAction: "CONFIRM" } },
    ],
    [
      "delivery_address_ambiguous",
      {
        ...result,
        address: {
          ...result.address,
          postalAddress: { ...result.address.postalAddress, postalCode: "52064" },
        },
      },
    ],
    [
      "delivery_address_unverified",
      { ...result, verdict: { ...result.verdict, geocodeGranularity: "ROUTE" } },
    ],
    [
      "delivery_address_unverified",
      { ...result, geocode: { location: { latitude: 95, longitude: 6 } } },
    ],
    [
      "delivery_address_unverified",
      {
        ...result,
        address: {
          ...result.address,
          addressComponents: [{ componentType: "route", confirmationLevel: "CONFIRMED" }],
        },
      },
    ],
    ["delivery_address_unavailable", {}],
  ])("classifies %s without guessing a delivery address", async (status, candidate) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ result: candidate }));
    expect(await verifyDeliveryAddress(env, input, fetcher)).toEqual({ status });
  });
  it.each([302, 429, 500])("fails safely for HTTP %d", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    expect(await verifyDeliveryAddress(env, input, fetcher)).toEqual({
      status: "delivery_address_unavailable",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("fails closed without a key and aborts a provider that exceeds the request deadline", async () => {
    const fetcher = vi.fn<typeof fetch>(
      (_, init) =>
        new Promise((_, reject) => {
          init!.signal!.addEventListener("abort", () => reject(new Error("Request timed out")), {
            once: true,
          });
        }),
    );
    expect(await verifyDeliveryAddress({}, input, fetcher)).toEqual({
      status: "delivery_address_unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await verifyDeliveryAddress(env, input, fetcher)).toEqual({
      status: "delivery_address_unavailable",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("cannot turn off verification in a hosted environment", () => {
    for (const APP_ENV of ["preview", "production"])
      expect(
        requiresDeliveryAddressValidation({
          APP_ENV,
          DELIVERY_ADDRESS_VALIDATION_ENABLED: "false",
        }),
      ).toBe(true);
  });
});
