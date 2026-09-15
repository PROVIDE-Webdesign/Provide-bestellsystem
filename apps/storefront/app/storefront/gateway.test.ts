import { describe, expect, it, vi } from "vitest";
import fixture from "../../../../fixtures/storefront-catalog.json";
import { fetchPublicStorefront } from "./gateway";
const params = {
  restaurantSlug: "storefront-restaurant-a",
  locationSlug: "storefront-a-mitte",
  resource: "catalog",
};
const request = new Request("https://store.example.test/api/storefront/test/middle/catalog", {
  headers: { authorization: "Bearer private", cookie: "private" },
});
describe("storefront public gateway", () => {
  it("uses only the configured upstream with no cookies, authorization, redirects or cache", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: fixture }));
    const response = await fetchPublicStorefront(
      request,
      params,
      "https://api.example.test",
      fetcher,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith(
      new URL(
        "https://api.example.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte/catalog",
      ),
      expect.objectContaining({
        cache: "no-store",
        redirect: "error",
        headers: { accept: "application/json" },
      }),
    );
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("private");
  });
  it("hides upstream exceptions and malformed output", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private"));
    expect(
      (await fetchPublicStorefront(request, params, "https://api.example.test", fetcher)).status,
    ).toBe(503);
    fetcher.mockResolvedValue(Response.json({ data: { secret: "private" } }));
    const response = await fetchPublicStorefront(
      request,
      params,
      "https://api.example.test",
      fetcher,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
  });
  it("rejects unconfigured or unsafe upstream URLs", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const base of [
      undefined,
      "http://example.com",
      "https://user:pass@example.com",
      "https://example.com/path",
      "file:///tmp/a",
    ])
      expect((await fetchPublicStorefront(request, params, base, fetcher)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves hidden-scope 404 while discarding internal error bodies", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ internal: "private" }, { status: 404 }));
    const response = await fetchPublicStorefront(
      request,
      params,
      "https://api.example.test",
      fetcher,
    );
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("private");
  });
});
