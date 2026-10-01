import { describe, it, expect, vi } from "vitest";
import raw from "../../../fixtures/order-history.json" with { type: "json" };
import { fetchOrderHistory, readHistoryBody } from "./gateway.js";
const scope = { restaurantId: raw.restaurantId, locationId: raw.locationId };
describe("bounded history gateway", () => {
  it("sends search name only in the POST body, with bearer and no cache", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: raw }));
    expect(
      (
        await fetchOrderHistory(
          "header.payload.signature",
          "https://api.test",
          scope,
          { customerName: "Synthetic" },
          fetcher,
        )
      ).status,
    ).toBe(200);
    const [url, options] = fetcher.mock.calls[0]!;
    if (!(url instanceof URL)) throw Error("Expected constructed API URL");
    expect(url.href).not.toContain("Synthetic");
    expect(options).toMatchObject({
      method: "POST",
      body: '{"customerName":"Synthetic"}',
      cache: "no-store",
      redirect: "manual",
    });
  });
  it("rejects oversized input and scope mismatch output", async () => {
    await expect(
      readHistoryBody(
        new Request("https://dashboard.test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ customerName: "x".repeat(2200) }),
        }),
      ),
    ).rejects.toThrow();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: { ...raw, locationId: "f3000000-0000-0000-0000-000000000002" } }),
      );
    expect(
      (await fetchOrderHistory("header.payload.signature", "https://api.test", scope, {}, fetcher))
        .status,
    ).toBe(503);
  });
  it("does not send invalid input or untrusted base URL", async () => {
    const fetcher = vi.fn();
    expect(
      (
        await fetchOrderHistory(
          "header.payload.signature",
          "https://api.test",
          scope,
          { customerName: "x" },
          fetcher,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await fetchOrderHistory(
          "header.payload.signature",
          "https://user:password@api.test",
          scope,
          {},
          fetcher,
        )
      ).status,
    ).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
