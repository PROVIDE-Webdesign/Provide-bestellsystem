import { describe, it, expect, vi } from "vitest";
import { createApiWorker } from "./index.js";
import type { DeliveryRepository } from "./delivery.js";
const request = {
  menuId: "f4000000-0000-0000-0000-000000000001",
  menuVersionId: "f5000000-0000-0000-0000-000000000001",
  requestedFor: "2026-09-16T18:00:00.000Z",
  lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 2 }],
  postalCode: "52062",
};
const quote = {
  policyId: "fb000000-0000-0000-0000-000000000001",
  subtotalAmountMinor: 2500,
  deliveryFeeAmountMinor: 350,
  totalAmountMinor: 2850,
  minimumAmountMinor: 2000,
  currency: "EUR",
};
const env = {
  APP_ENV: "test",
  DELIVERY_ORDERING_ENABLED: "true",
  HYPERDRIVE_CACHE_DISABLED: "true",
  HYPERDRIVE: { connectionString: "postgresql://synthetic.invalid/db" },
};
function setup() {
  const repository: DeliveryRepository = {
    quote: vi.fn().mockResolvedValue(quote),
    submit: vi.fn(),
  };
  const logger = { error: vi.fn() };
  const worker = createApiWorker(
    undefined,
    logger,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    repository,
  );
  const post = (body: unknown = request, environment = env, resource = "delivery-quote") =>
    worker.fetch(
      new Request(`https://api.test/v1/storefront/restaurant-a/location-a/${resource}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      environment,
    );
  return { post, repository, logger };
}
describe("delivery HTTP boundary", () => {
  it("returns a safe no-store quote", async () => {
    const { post } = setup();
    const r = await post();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    await expect(r.json()).resolves.toMatchObject({ data: quote });
  });
  it("closes before database access when delivery or uncached transport is disabled", async () => {
    const { post, repository } = setup();
    expect((await post(request, { ...env, DELIVERY_ORDERING_ENABLED: "false" })).status).toBe(503);
    expect((await post(request, { ...env, HYPERDRIVE_CACHE_DISABLED: "false" })).status).toBe(503);
    expect(repository.quote).not.toHaveBeenCalled();
  });
  it("rejects extra price fields before database access", async () => {
    const { post, repository } = setup();
    expect((await post({ ...request, feeAmountMinor: 0 })).status).toBe(400);
    expect(repository.quote).not.toHaveBeenCalled();
  });
  it("does not disclose database errors, postal codes or addresses", async () => {
    const { post, repository, logger } = setup();
    vi.mocked(repository.quote).mockRejectedValue(new Error("Testweg 10 +999100000001 52062"));
    const r = await post();
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("Testweg");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("52062");
  });

  it("distinguishes a definite database rejection from an uncertain transport failure", async () => {
    const { post, repository } = setup();
    vi.mocked(repository.quote).mockRejectedValue({
      code: "P0001",
      message: "delivery quote changed",
    });
    expect((await post()).status).toBe(409);
  });
  it("requires the existing checkout and token gates for submission", async () => {
    const { post, repository } = setup();
    expect((await post({}, env, "delivery-orders")).status).toBe(503);
    expect(repository.submit).not.toHaveBeenCalled();
  });
});
