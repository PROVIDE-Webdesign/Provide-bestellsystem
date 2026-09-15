export function GET() {
  return Response.json(
    {
      application: "dashboard",
      environment: "preview",
      runtime: "cloudflare-workers-vinext",
      status: "ok",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
