import { describe, expect, it, vi } from "vitest";
import fixture from "../../../fixtures/storefront-catalog.json" with { type: "json" };
import { createApiWorker } from "./index.js";

const base = "https://api.example.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte";
const env = {
  APP_ENV: "test",
  HYPERDRIVE: { connectionString: "postgresql://synthetic.invalid/db" },
  HYPERDRIVE_CACHE_DISABLED: "true",
};
function setup() {
  const reader = {
    catalog: vi.fn().mockResolvedValue(fixture),
    availability: vi.fn().mockResolvedValue({
      status: "available",
      fulfillmentType: "pickup",
      requestedFor: "2026-09-14T12:00:00Z",
      itemCount: 2,
      evaluatedAt: "2026-09-14T11:00:00Z",
    }),
  };
  const logger = { error: vi.fn() };
  return { reader, logger, worker: createApiWorker(vi.fn(), logger, reader) };
}
const query = "fulfillmentType=pickup&requestedFor=2026-09-14T12%3A00%3A00Z&itemCount=2";
describe("public storefront HTTP reads", () => {
  it("routes scoped catalog with the existing envelope, headers and no cache", async () => {
    const { worker, reader } = setup();
    const response = await worker.fetch(new Request(`${base}/catalog`), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({ data: fixture });
    expect(reader.catalog).toHaveBeenCalledWith(
      env.HYPERDRIVE.connectionString,
      expect.objectContaining({
        restaurantSlug: "storefront-restaurant-a",
        locationSlug: "storefront-a-mitte",
      }),
    );
  });
  it("passes validated availability selectors without accepting a client evaluation time", async () => {
    const { worker, reader } = setup();
    expect((await worker.fetch(new Request(`${base}/availability?${query}`), env)).status).toBe(
      200,
    );
    expect(reader.availability).toHaveBeenCalledWith(
      env.HYPERDRIVE.connectionString,
      expect.objectContaining({ itemCount: 2, fulfillmentType: "pickup" }),
    );
    expect(
      (await worker.fetch(new Request(`${base}/availability?${query}&evaluatedAt=2020`), env))
        .status,
    ).toBe(400);
  });
  it.each([
    "",
    "fulfillmentType=delivery",
    `${query}&itemCount=1`,
    query.replace("itemCount=2", "itemCount=1001"),
    query.replace("itemCount=2", "itemCount=1.5"),
    query.replace("pickup", "invalid"),
    query.replace("2026-09-14T12%3A00%3A00Z", "2026-02-30T12%3A00%3A00Z"),
  ])("rejects invalid query before SQL: %s", async (invalid) => {
    const { worker, reader } = setup();
    expect((await worker.fetch(new Request(`${base}/availability?${invalid}`), env)).status).toBe(
      400,
    );
    expect(reader.availability).not.toHaveBeenCalled();
  });
  it("blocks query overrides, encoded tenant identifiers and unsupported methods", async () => {
    const { worker, reader } = setup();
    for (const url of [
      `${base}/catalog?restaurantId=other`,
      base.replace("storefront-restaurant-a", "bad%27slug") + "/catalog",
    ])
      expect((await worker.fetch(new Request(url), env)).status).toBe(400);
    expect(
      (await worker.fetch(new Request(`${base}/catalog`, { method: "POST" }), env)).status,
    ).toBe(405);
    expect(reader.catalog).not.toHaveBeenCalled();
  });
  it("uses uniform 404 responses for every hidden scope", async () => {
    const { worker, reader } = setup();
    reader.catalog.mockResolvedValue(null);
    const response = await worker.fetch(new Request(`${base}/catalog`), env);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "not_found", message: "Resource was not found." },
    });
  });
  it("removes unapproved fields in every nested output", async () => {
    const { worker, reader } = setup();
    reader.catalog.mockResolvedValue({
      ...fixture,
      contact: "hidden",
      restaurant: { ...fixture.restaurant, actorId: "hidden" },
    });
    reader.availability.mockResolvedValue({
      status: "unavailable",
      fulfillmentType: "pickup",
      requestedFor: "2026-09-14T12:00:00Z",
      itemCount: 2,
      evaluatedAt: "2026-09-14T11:00:00Z",
      maximum_orders: 10,
      reason_code: "capacity_exhausted",
    });
    expect(await (await worker.fetch(new Request(`${base}/catalog`), env)).text()).not.toContain(
      "hidden",
    );
    const response = await (
      await worker.fetch(new Request(`${base}/availability?${query}`), env)
    ).text();
    expect(response).not.toContain("capacity");
    expect(response).not.toContain("maximum_orders");
  });
  it("fails closed on invalid upstream data and DB exceptions; logs only event and request ID", async () => {
    const { worker, reader, logger } = setup();
    reader.catalog.mockResolvedValue({ password: "secret" });
    expect((await worker.fetch(new Request(`${base}/catalog`), env)).status).toBe(503);
    reader.catalog.mockRejectedValue(new Error("password=secret"));
    const response = await worker.fetch(new Request(`${base}/catalog`), env);
    expect(await response.text()).not.toContain("secret");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret");
  });
  it("will not use an unverified cached database configuration", async () => {
    const { worker, reader } = setup();
    expect(
      (
        await worker.fetch(new Request(`${base}/catalog`), {
          ...env,
          HYPERDRIVE_CACHE_DISABLED: "false",
        })
      ).status,
    ).toBe(503);
    expect(reader.catalog).not.toHaveBeenCalled();
  });
});
