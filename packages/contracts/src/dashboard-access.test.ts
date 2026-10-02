import { describe, expect, it } from "vitest";

import { parseDashboardAccessContext } from "./dashboard-access.js";

const allowed = {
  aal: "aal2",
  memberships: [
    {
      restaurantId: "f2000000-0000-0000-0000-000000000001",
      role: "manager",
      status: "active",
      access: "allowed",
      restaurant: { slug: "restaurant-a", displayName: "Restaurant A" },
      locations: [
        {
          id: "f3000000-0000-0000-0000-000000000001",
          slug: "mitte",
          displayName: "Mitte",
        },
      ],
    },
  ],
};

describe("dashboard access contract", () => {
  it.each(["aal1", "aal2"])(
    "accepts explicit Viewer access at %s without broadening unknown roles",
    (aal) => {
      const membership = { ...allowed.memberships[0], role: "viewer" };
      expect(parseDashboardAccessContext({ aal, memberships: [membership] })).toBeDefined();
      expect(
        parseDashboardAccessContext({ aal, memberships: [{ ...membership, role: "superadmin" }] }),
      ).toBeUndefined();
    },
  );
  it("accepts an allowlisted active membership", () => {
    expect(parseDashboardAccessContext({ ...allowed, ignored: true })).toBeUndefined();
    expect(parseDashboardAccessContext(allowed)).toEqual(allowed);
  });

  it("accepts minimal MFA and suspension states", () => {
    for (const membership of [
      {
        restaurantId: "f2000000-0000-0000-0000-000000000001",
        role: "owner",
        status: "active",
        access: "mfa_required",
        restaurant: null,
        locations: [],
      },
      {
        restaurantId: "f2000000-0000-0000-0000-000000000001",
        role: "kitchen",
        status: "suspended",
        access: "suspended",
        restaurant: null,
        locations: [],
      },
    ]) {
      expect(parseDashboardAccessContext({ aal: "aal1", memberships: [membership] })).toEqual({
        aal: "aal1",
        memberships: [membership],
      });
    }
  });

  it("rejects profile disclosure before access is allowed", () => {
    expect(
      parseDashboardAccessContext({
        aal: "aal1",
        memberships: [
          {
            ...allowed.memberships[0],
            access: "mfa_required",
            restaurant: { slug: "hidden", displayName: "Hidden" },
            locations: [],
          },
        ],
      }),
    ).toBeUndefined();
  });
});
