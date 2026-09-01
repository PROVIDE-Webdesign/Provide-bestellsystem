export function GET() {
  return Response.json({
    application: "storefront",
    environment: "preview",
    runtime: "cloudflare-workers-vinext",
    status: "ok",
  });
}
