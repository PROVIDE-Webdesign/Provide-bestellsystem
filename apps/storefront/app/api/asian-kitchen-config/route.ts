import { env } from "cloudflare:workers";

/** Public configuration only. The existing same-origin gateway keeps all secrets server-side. */
export async function GET(): Promise<Response> {
  return Response.json(
    {
      enabled: env.ASIAN_KITCHEN_DEMO_ENABLED === "true" && env.CHECKOUT_PROTECTION_ENABLED === "true",
      restaurantSlug: "storefront-restaurant-a",
      locationSlug: "storefront-a-mitte",
      siteKey: env.PUBLIC_CHECKOUT_TURNSTILE_SITE_KEY ?? "",
      privacyNoticeVersion: env.PUBLIC_CHECKOUT_PRIVACY_NOTICE_VERSION ?? "",
    },
    { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}
