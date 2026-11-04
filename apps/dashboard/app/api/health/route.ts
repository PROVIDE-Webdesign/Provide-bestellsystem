export function GET() {
  return Response.json(
    {
      application: "dashboard",
      environment: process.env.APP_ENV === "production" ? "production" : "preview",
      runtime: "cloudflare-workers-vinext",
      status: "ok",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
