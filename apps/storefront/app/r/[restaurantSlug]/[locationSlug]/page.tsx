import Storefront from "../../../storefront/Storefront";
export default async function Page({
  params,
}: {
  params: Promise<{ restaurantSlug: string; locationSlug: string }>;
}) {
  const scope = await params;
  return <Storefront {...scope} />;
}
