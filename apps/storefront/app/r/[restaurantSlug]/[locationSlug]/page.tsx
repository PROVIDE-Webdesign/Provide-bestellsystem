import Storefront from "../../../storefront/Storefront";
import { env } from "cloudflare:workers";
export default async function Page({
  params,
}: {
  params: Promise<{ restaurantSlug: string; locationSlug: string }>;
}) {
  const scope = await params;
  return (
    <Storefront
      {...scope}
      privacyNoticeVersion={env.PUBLIC_CHECKOUT_PRIVACY_NOTICE_VERSION ?? "unconfigured"}
    />
  );
}
