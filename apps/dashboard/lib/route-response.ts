const headers = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export function dashboardRouteFailure(status: 400 | 401 | 503) {
  const code =
    status === 400 ? "bad_request" : status === 401 ? "unauthorized" : "service_unavailable";
  return Response.json({ error: { code } }, { headers, status });
}
