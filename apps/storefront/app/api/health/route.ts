export function GET() {
  return Response.json({
    application: "storefront",
    environment: process.env.APP_ENV === "production" ? "production" : "preview",
    runtime: "cloudflare-workers-vinext",
    status: "ok",
  });
}
