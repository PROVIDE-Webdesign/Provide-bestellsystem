import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session.js", () => ({ dashboardAccessToken: vi.fn() }));

import { POST as statusPost } from "./[orderId]/status/route.js";
import { POST as communicationPost } from "./[orderId]/communication/route.js";

const context = {
  params: Promise.resolve({ orderId: "fa000000-0000-0000-0000-000000000001" }),
};

afterEach(() => vi.unstubAllEnvs());

describe.each([
  ["status", statusPost],
  ["communication", communicationPost],
] as const)("dashboard %s same-origin boundary", (_name, POST) => {
  function enable() {
    vi.stubEnv("DASHBOARD_AUTH_ENABLED", "true");
    vi.stubEnv("DASHBOARD_ORDER_OPERATIONS_ENABLED", "true");
  }

  it("rejects a cross-site JSON command before reading a session", async () => {
    enable();
    const response = await POST(
      new Request("https://dashboard.example.test/api/orders/order/status", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://attacker.example.test" },
        body: "{}",
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("requires JSON and enforces the narrow body bound", async () => {
    enable();
    expect(
      (
        await POST(
          new Request("https://dashboard.example.test/api/orders/order/status", {
            method: "POST",
            headers: { "content-type": "text/plain", origin: "https://dashboard.example.test" },
            body: "{}",
          }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          new Request("https://dashboard.example.test/api/orders/order/status", {
            method: "POST",
            headers: {
              "content-length": "1025",
              "content-type": "application/json",
              origin: "https://dashboard.example.test",
            },
            body: "{}",
          }),
          context,
        )
      ).status,
    ).toBe(400);
  });
});
