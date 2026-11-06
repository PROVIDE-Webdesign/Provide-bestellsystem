import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), end: vi.fn() }));
vi.mock("pg", () => ({
  Client: class {
    connect = db.connect;
    query = db.query;
    end = db.end;
  },
}));
import { postgresCheckoutProtection } from "./checkout-protection-database.js";
beforeEach(() => {
  vi.clearAllMocks();
  db.query.mockResolvedValue({ rows: [{ data: { outcome: "ok" } }] });
});
const scope = { restaurantSlug: "synthetic", locationSlug: "synthetic" };
describe("protected checkout capture transaction", () => {
  it.each(["orders", "delivery-orders", "online-orders"])(
    "sets reservation mode only for %s within the submission transaction",
    async (mode) => {
      await postgresCheckoutProtection.submit(
        "synthetic",
        "hash",
        crypto.randomUUID(),
        scope,
        mode,
        "fingerprint",
        {},
        14,
        "acct_synthetic",
      );
      const statements = db.query.mock.calls.map((c) => String(c[0]));
      const flag = statements.findIndex((s) => s.includes("provide.manual_capture"));
      const submit = statements.findIndex((s) => s.includes("private.checkout_submit"));
      if (mode === "online-orders") {
        expect(flag).toBeGreaterThan(statements.indexOf("BEGIN"));
        expect(flag).toBeLessThan(submit);
        expect(statements[flag]).toContain("'on', true");
      } else expect(flag).toBe(-1);
      expect(statements.indexOf("COMMIT")).toBeGreaterThan(submit);
      expect(db.end).toHaveBeenCalledOnce();
    },
  );
  it("rolls back when enabling reservation fails instead of silently charging automatically", async () => {
    db.query.mockImplementation((sql: string) => {
      if (sql.includes("provide.manual_capture"))
        return Promise.reject(new Error("reservation unavailable"));
      return Promise.resolve({ rows: [{ data: {} }] });
    });
    await expect(
      postgresCheckoutProtection.submit(
        "synthetic",
        "hash",
        crypto.randomUUID(),
        scope,
        "online-orders",
        "fingerprint",
        {},
        14,
        "acct_synthetic",
      ),
    ).rejects.toThrow("reservation unavailable");
    const statements = db.query.mock.calls.map((c) => String(c[0]));
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(statements.some((s) => s.includes("private.checkout_submit"))).toBe(false);
    expect(db.end).toHaveBeenCalledOnce();
  });
});
