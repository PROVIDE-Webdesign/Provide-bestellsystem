import type { Client } from "pg";
import { expect, vi } from "vitest";
import { parseProvideAdminState, type ProvideAdminCommand } from "@provide/contracts";
import { createApiWorker } from "./index.js";
import {
  captureActivationFixture,
  restoreActivationFixture,
} from "./activation-fixture.integration.js";
export async function verifyProvideIntegration(
  admin: Client,
  sourceEnv: Parameters<ReturnType<typeof createApiWorker>["fetch"]>[1],
) {
  const r = "f2000000-0000-0000-0000-000000000001",
    l = "f3000000-0000-0000-0000-000000000001",
    actor = "f1000000-0000-0000-0000-000000000009";
  const activation = await captureActivationFixture(admin, r);
  await admin.query("insert into auth.users(id,email) values($1,'provide-http@example.invalid')", [
    actor,
  ]);
  await admin.query(
    "insert into private.provide_admin_grants(user_id,restaurant_id) values($1,$2)",
    [actor, r],
  );
  const worker = createApiWorker(undefined, { error: vi.fn() }, undefined, undefined, undefined, {
    verify: () => Promise.resolve({ userId: actor, aal: "aal2" }),
  });
  const env = { ...sourceEnv, PROVIDE_ADMIN_ENABLED: "true", PROVIDE_ADMIN_LIVE_ENABLED: "false" };
  const send = async (q: unknown, status = 200) => {
    const response = await worker.fetch(
      new Request("https://api.test/v1/provide/administration", {
        method: "POST",
        headers: {
          authorization: "Bearer header.payload.signature",
          "content-type": "application/json",
        },
        body: JSON.stringify(q),
      }),
      env,
    );
    expect(response.status, await response.clone().text()).toBe(status);
    if (status !== 200) return null;
    const envelope: { data?: unknown } = await response.json();
    const state = parseProvideAdminState(envelope.data);
    expect(state).toBeDefined();
    return state!;
  };
  const query = { action: "read", restaurantId: r, locationId: l } as const;
  let state = (await send(query))!;
  expect(state.selected?.locationId).toBe(l);
  expect(state.liveActionsEnabled).toBe(false);
  await send({ ...query, restaurantId: "f2000000-0000-0000-0000-000000000002" }, 403);
  await send({ ...query, actorUserId: actor }, 400);
  const base = {
    action: "feature",
    restaurantId: r,
    locationId: l,
    expectedRevision: state.selected!.revision,
    requestId: crypto.randomUUID(),
    reason: "Synthetic HTTP feature review",
    featureKey: "catalog.public_menu",
    mode: "disabled",
    expiresAt: null,
  } as const;
  const commands: ProvideAdminCommand[] = [base, { ...base, requestId: crypto.randomUUID() }];
  const responses = await Promise.all(
    commands.map((q) =>
      worker.fetch(
        new Request("https://api.test/v1/provide/administration", {
          method: "POST",
          headers: {
            authorization: "Bearer header.payload.signature",
            "content-type": "application/json",
          },
          body: JSON.stringify(q),
        }),
        env,
      ),
    ),
  );
  expect(responses.map((x) => x.status).sort()).toEqual([200, 409]);
  const winner = commands[responses.findIndex((x) => x.status === 200)]!;
  const count = async () =>
    (
      await admin.query<{ n: string }>(
        "select count(*)::text n from private.provide_admin_audit where restaurant_id=$1",
        [r],
      )
    ).rows[0]!.n;
  const before = await count();
  state = (await send(winner))!;
  expect(await count()).toBe(before);
  expect(
    state.selected?.features.find((x) => x.key === "catalog.public_menu")?.effectiveEnabled,
  ).toBe(false);
  const catalogUrl =
    "https://api.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte/catalog";
  expect((await worker.fetch(new Request(catalogUrl), env)).status).toBe(404);
  await admin.query("update private.provide_admin_grants set active=false where user_id=$1", [
    actor,
  ]);
  await send(query, 403);
  await send(winner, 403);
  await admin.query("update private.provide_admin_grants set active=true where user_id=$1", [
    actor,
  ]);
  state = (await send(query))!;
  await send({
    ...base,
    requestId: crypto.randomUUID(),
    expectedRevision: state.selected!.revision,
    mode: "inherit",
  });
  expect((await worker.fetch(new Request(catalogUrl), env)).status).toBe(200);
  state = (await send(query))!;
  await send(
    {
      action: "goLive",
      restaurantId: r,
      locationId: l,
      expectedRevision: state.selected!.revision,
      requestId: crypto.randomUUID(),
      reason: "Synthetic live guard check",
      status: "live",
      confirmation: state.selected!.scopeSlug,
    },
    503,
  );
  await admin.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1", [
    actor,
  ]);
  await send(query, 403);
  await admin.query("update auth.users set banned_until=null where id=$1", [actor]);
  const orders = (
    await admin.query<{ n: string }>(
      "select count(*)::text n from public.orders where restaurant_id=$1",
      [r],
    )
  ).rows[0]!.n;
  state = (await send({ action: "read", restaurantId: r }))!;
  await send({
    action: "critical",
    restaurantId: r,
    locationId: null,
    expectedRevision: state.selected!.revision,
    requestId: crypto.randomUUID(),
    reason: "Synthetic critical recheck",
    configuration: {
      merchantRole: "restaurant",
      payoutAccountReference: "fixture:http-payout",
      productionDomain: "http.example.invalid",
      dataRegion: "eu-central-1",
      responsibleUserId: actor,
    },
  });
  expect(
    (
      await admin.query<{ n: string }>(
        "select count(*)::text n from public.orders where restaurant_id=$1",
        [r],
      )
    ).rows[0]!.n,
  ).toBe(orders);
  expect((await worker.fetch(new Request(catalogUrl), env)).status).toBe(404);
  expect((await send(query))?.selected?.checks.every((x) => x.status === "pending")).toBe(true);
  // The private Realtime scenario uses this same disposable restaurant next.
  // Restore only after asserting the real critical-change gate and order preservation.
  await restoreActivationFixture(admin, r, activation);
}
