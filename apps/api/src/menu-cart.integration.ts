import { expect } from "vitest";
import type { Client } from "pg";
import { postgresMenuAdmin } from "./menu-admin.js";
import { createApiWorker } from "./index.js";
import {
  type MenuAdminCommand,
  parseMenuConfiguration,
  parseMenuAdminState,
  parseCartQuote,
  parseGuestPickupOrderConfirmation,
  parseDashboardOrderDetail,
} from "@provide/contracts";
import rawConfiguration from "../../../fixtures/menu-configuration.json" with { type: "json" };
const configuration = parseMenuConfiguration(rawConfiguration)!;
type Env = Parameters<ReturnType<typeof createApiWorker>["fetch"]>[1];
const restaurantId = "f2000000-0000-0000-0000-000000000001",
  locationId = "f3000000-0000-0000-0000-000000000001",
  owner = "f1000000-0000-0000-0000-000000000001",
  menuId = "f4000000-0000-0000-0000-000000000001",
  oldVersion = "f5000000-0000-0000-0000-000000000001";
async function data(r: Response): Promise<unknown> {
  expect(r.status).toBeLessThan(300);
  const body: unknown = await r.json();
  if (!body || typeof body !== "object" || !("data" in body)) throw Error("Missing envelope");
  return body.data;
}
export async function verifyMenuCartIntegration(admin: Client, baseEnv: Env) {
  const env = { ...baseEnv, DASHBOARD_MENU_ENABLED: "true", CART_QUOTE_ENABLED: "true" };
  const worker = createApiWorker(undefined, undefined, undefined, undefined, undefined, {
    verify: () => Promise.resolve({ userId: owner, aal: "aal2" }),
  });
  const menuUrl = `https://api.test/v1/dashboard/restaurants/${restaurantId}/locations/${locationId}/menu`;
  const read = () =>
    worker.fetch(
      new Request(menuUrl, { headers: { authorization: "Bearer header.payload.signature" } }),
      env,
    );
  const command = (cmd: MenuAdminCommand) =>
    worker.fetch(
      new Request(menuUrl, {
        method: "POST",
        headers: {
          authorization: "Bearer header.payload.signature",
          "content-type": "application/json",
        },
        body: JSON.stringify(cmd),
      }),
      env,
    );
  const projection = await postgresMenuAdmin(
    env.HYPERDRIVE!.connectionString,
    { userId: owner, aal: "aal2" },
    restaurantId,
    locationId,
    null,
  );
  expect(projection).toMatchObject({ outcome: "allowed" });
  expect(
    projection && typeof projection === "object" && "data" in projection
      ? parseMenuAdminState(projection.data)
      : undefined,
  ).toBeDefined();
  const before = parseMenuAdminState(await data(await read()))!;
  expect(before.timezone).toBe("Europe/Berlin");
  const created = parseMenuAdminState(
    await data(await command({ action: "create_draft", menuId, sourceVersionId: oldVersion })),
  )!;
  const draft = created.menus.find((m) => m.id === menuId)!.versions[0]!;
  expect(draft.status).toBe("draft");
  const items = draft.items.map((i) => ({
    ...i,
    name: i.name.replace(/\s+/g, " "),
    configuration: i.isActive
      ? i.id.endsWith("1")
        ? configuration
        : { ...configuration, allergens: [], variants: [], optionGroups: [] }
      : null,
  }));
  const configuredItem = items.find((i) => i.id === "f6000000-0000-0000-0000-000000000001")!;
  const save = {
    action: "save_draft" as const,
    menuId,
    versionId: draft.id,
    expectedRevision: draft.revision,
    sections: draft.sections,
    items,
  };
  const saved = parseMenuAdminState(await data(await command(save)))!;
  expect(saved.menus.find((m) => m.id === menuId)!.versions[0]!.revision).toBe(1);
  expect((await command(save)).status).toBe(409);
  expect(
    (
      await command({
        action: "publish",
        menuId,
        versionId: draft.id,
        expectedRevision: 1,
        effectiveAt: new Date().toISOString(),
        note: "Synthetic connected publication",
      })
    ).status,
  ).toBe(200);
  const base = "https://api.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte/";
  const when = new Date(Date.now() + 20 * 3600000);
  when.setUTCMinutes(0, 0, 0);
  const lines = [
    {
      menuItemId: configuredItem.id,
      quantity: 1,
      variantId: configuration.variants[1]!.id,
      optionIds: [configuration.optionGroups[0]!.options[1]!.id],
    },
  ];
  const reviewRequest = {
    menuId,
    menuVersionId: oldVersion,
    fulfillmentType: "pickup",
    requestedFor: when.toISOString(),
    lines,
  };
  const post = (resource: string, body: unknown) =>
    worker.fetch(
      new Request(base + resource, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
    );
  const quote = parseCartQuote(await data(await post("cart-quote", reviewRequest)))!;
  expect(quote).toMatchObject({
    status: "changed",
    currentMenuVersionId: draft.id,
    subtotalAmountMinor: 1500,
  });
  const stop = {
    action: "stop" as const,
    menuId,
    versionId: draft.id,
    itemId: configuredItem.id,
    choiceId: configuration.variants[1]!.id,
    blocked: true,
    endsAt: null,
    reason: "Synthetic test stop",
  };
  expect((await command(stop)).status).toBe(200);
  expect(parseCartQuote(await data(await post("cart-quote", reviewRequest)))?.status).toBe(
    "unavailable",
  );
  const order = {
    ...reviewRequest,
    menuVersionId: draft.id,
    customer: {
      contactName: "Synthetic",
      phoneE164: "+999100000001",
      email: "synthetic@example.invalid",
    },
    privacyNoticeVersion: "preview-v1",
    submissionKey: "menu-cart-connected-pickup-0001",
  };
  const { fulfillmentType: _type, ...pickupRequest } = order;
  void _type;
  expect((await post("orders", pickupRequest)).status).toBe(409);
  expect((await command({ ...stop, blocked: false })).status).toBe(200);
  const confirmation = parseGuestPickupOrderConfirmation(
    await data(await post("orders", pickupRequest)),
  )!;
  expect(confirmation.totalAmountMinor).toBe(1500);
  const detail = await worker.fetch(
    new Request(
      `https://api.test/v1/dashboard/restaurants/${restaurantId}/locations/${locationId}/orders/${confirmation.orderId}`,
      { headers: { authorization: "Bearer header.payload.signature" } },
    ),
    env,
  );
  const snapshot = parseDashboardOrderDetail(await data(detail))?.lines[0]?.selectionSnapshot;
  expect(snapshot?.variant?.name).toBe("Large");
  expect(snapshot?.options[0]?.name).toBe("Extra B");
  expect(
    (
      await command({
        action: "rollback",
        menuId,
        versionId: oldVersion,
        expectedRevision: 0,
        effectiveAt: new Date().toISOString(),
        note: "Synthetic rollback",
      })
    ).status,
  ).toBe(200);
  const history = await admin.query<{ selection_snapshot: unknown }>(
    "select selection_snapshot from public.order_lines where order_id=$1",
    [confirmation.orderId],
  );
  expect(history.rows[0]!.selection_snapshot).toEqual(snapshot);
  const retry = parseGuestPickupOrderConfirmation(await data(await post("orders", pickupRequest)))!;
  expect(retry.orderId).toBe(confirmation.orderId);
}
