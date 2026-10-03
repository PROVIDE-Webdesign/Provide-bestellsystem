import { it, expect, vi } from "vitest";
import raw from "../../../fixtures/support.json" with { type: "json" };
import { fetchSupport, readSupportBody } from "./gateway.js";
const command = {
  action: "read",
  restaurantId: raw.restaurantId,
  locationId: raw.locationId,
  cursor: null,
  caseId: null,
} as const;
it("O1 rejects unsafe hosts, redirects and foreign projections with no token response", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: raw }));
  for (const base of [
    "https://user:pass@api.test/",
    "https://api.test/?token=x",
    "http://external.test/",
  ])
    expect((await fetchSupport("a.b.c", base, command, fetcher)).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await fetchSupport("a.b.c", "https://api.test", command, fetcher)).status).toBe(200);
  expect(fetcher).toHaveBeenCalledWith(
    new URL("https://api.test/v1/provide/support"),
    expect.objectContaining({ cache: "no-store", redirect: "manual", method: "POST" }),
  );
  fetcher.mockResolvedValue(Response.json({ data: { ...raw, locationId: raw.restaurantId } }));
  expect((await fetchSupport("a.b.c", "https://api.test", command, fetcher)).status).toBe(503);
  fetcher.mockResolvedValue(
    new Response(null, { status: 302, headers: { location: "https://attacker.test" } }),
  );
  expect((await fetchSupport("a.b.c", "https://api.test", command, fetcher)).status).toBe(503);
});
it("O1 bounded body rejects unknown fields and non-JSON content", async () => {
  await expect(
    readSupportBody(
      new Request("https://dashboard.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...command, note: "guest@example.invalid" }),
      }),
    ),
  ).rejects.toThrow();
});
