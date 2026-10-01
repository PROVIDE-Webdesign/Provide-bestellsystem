import { describe, it, expect, vi } from "vitest";
import { fetchDashboardMenu, readDashboardMenuBody } from "./gateway.js";
const scope = {
  restaurantId: "f2000000-0000-0000-0000-000000000001",
  locationId: "f3000000-0000-0000-0000-000000000001",
};
const token = "header.payload.signature";
describe("bounded menu gateway", () => {
  it("forwards only a scoped verified bearer and reconstructs the menu projection", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { data: { timezone: "Europe/Berlin", stops: [], menus: [], actor: "private" } },
          { headers: { "content-type": "application/json" } },
        ),
      );
    const response = await fetchDashboardMenu(token, "https://api.test", scope, null, fetcher);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("private");
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer " + token,
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual", cache: "no-store" });
  });
  it("keeps editing conflicts without upstream text", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: token }, { status: 409 }));
    const r = await fetchDashboardMenu(
      token,
      "https://api.test",
      scope,
      { action: "create_menu", name: "Synthetic", slug: "synthetic" },
      fetcher,
    );
    expect(r.status).toBe(409);
    expect(await r.text()).not.toContain(token);
  });
  it("rejects unsafe scopes and command actor injection before the API", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      (await fetchDashboardMenu(token, "https://user:secret@api.test", scope, null, fetcher))
        .status,
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      readDashboardMenuBody(
        new Request("https://dashboard.test/api/menu", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "create_menu",
            name: "Synthetic",
            slug: "synthetic",
            actor: token,
          }),
        }),
      ),
    ).rejects.toThrow();
  });
  it("limits streamed commands and invalid upstream projections", async () => {
    await expect(
      readDashboardMenuBody(
        new Request("https://dashboard.test/api/menu", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: " ".repeat(512 * 1024 + 1),
        }),
      ),
    ).rejects.toThrow();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { menus: [] } }));
    expect((await fetchDashboardMenu(token, "https://api.test", scope, null, fetcher)).status).toBe(
      503,
    );
  });
});
