import { describe, expect, it } from "vitest";
import {
  createStatusAccessToken,
  statusAvailableUntil,
  verifyStatusAccessToken,
} from "./status-token.js";

const scope = { restaurantSlug: "restaurant-a", locationSlug: "location-a" };
const orderId = "fa000000-0000-0000-0000-000000000001";
const current = "current-synthetic-secret-with-at-least-32-bytes";
const previous = "previous-synthetic-secret-with-at-least-32-bytes";

describe("public order status token", () => {
  it("creates a deterministic scoped HMAC capability", async () => {
    const token = await createStatusAccessToken(current, scope, orderId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await createStatusAccessToken(current, scope, orderId)).toBe(token);
    expect(await verifyStatusAccessToken(token, [current], scope, orderId)).toBe(true);
    expect(
      await verifyStatusAccessToken(token, [current], { ...scope, locationSlug: "other" }, orderId),
    ).toBe(false);
    const tampered = `${token.startsWith("A") ? "B" : "A"}${token.slice(1)}`;
    expect(await verifyStatusAccessToken(tampered, [current], scope, orderId)).toBe(false);
  });

  it("accepts a previous secret during controlled rotation", async () => {
    const oldToken = await createStatusAccessToken(previous, scope, orderId);
    expect(await verifyStatusAccessToken(oldToken, [current, previous], scope, orderId)).toBe(true);
  });

  it("requires a sufficiently long secret and derives the server expiry", async () => {
    await expect(createStatusAccessToken("short", scope, orderId)).rejects.toThrow();
    expect(statusAvailableUntil("2026-09-15T12:00:00Z")).toBe("2026-09-17T12:00:00.000Z");
  });
});
