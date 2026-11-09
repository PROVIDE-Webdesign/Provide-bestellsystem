import { pickupPreviewWindow } from "../../../storefront/pickup-window";
import Storefront from "../../../storefront/Storefront";
import { isCheckoutTestHostname } from "@provide/contracts";
import { env } from "cloudflare:workers";
function livePrivacyUrl(raw: string | undefined): string | undefined {
  try {
    const u = new URL(raw ?? "");
    if (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !isCheckoutTestHostname(u.hostname)
    )
      return u.href;
  } catch {
    return;
  }
}
export default async function Page({
  params,
}: {
  params: Promise<{ restaurantSlug: string; locationSlug: string }>;
}) {
  const scope = await params;
  const production = env.APP_ENV === "production";
  const pickupWindow = production
    ? undefined
    : pickupPreviewWindow(
        env.PUBLIC_PICKUP_PREVIEW_SCHEDULE,
        scope.restaurantSlug,
        scope.locationSlug,
      );
  const noticeVersion = env.PUBLIC_CHECKOUT_PRIVACY_NOTICE_VERSION ?? "unconfigured";
  const privacyUrl =
    production && /^live-[A-Za-z0-9_-]+$/.test(noticeVersion)
      ? livePrivacyUrl(env.PUBLIC_LIVE_CHECKOUT_PRIVACY_URL)
      : undefined;
  return (
    <Storefront
      {...scope}
      checkoutProtectionEnabled={env.CHECKOUT_PROTECTION_ENABLED === "true"}
      checkoutTurnstileSiteKey={env.PUBLIC_CHECKOUT_TURNSTILE_SITE_KEY ?? ""}
      production={production}
      onlinePaymentEnabled={
        production
          ? !!privacyUrl && env.PUBLIC_LIVE_ONLINE_PAYMENT_ENABLED === "true"
          : env.PUBLIC_ONLINE_PAYMENT_ENABLED === "true"
      }
      privacyNoticeVersion={noticeVersion}
      {...(pickupWindow ? { pickupWindow } : {})}
      {...(privacyUrl ? { livePrivacyUrl: privacyUrl } : {})}
    />
  );
}
