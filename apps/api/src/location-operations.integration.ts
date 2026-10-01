import { expect } from "vitest";
import type { Client } from "pg";
import { parseDeliveryQuote, parseLocationOperationsState } from "@provide/contracts";
import { createApiWorker } from "./index.js";
type Env = Parameters<ReturnType<typeof createApiWorker>["fetch"]>[1];
export async function verifyLocationOperationsIntegration(admin: Client, sourceEnv: Env) {
  const env = {
    ...sourceEnv,
    DASHBOARD_LOCATION_OPERATIONS_ENABLED: "true",
    DELIVERY_ORDERING_ENABLED: "true",
  };
  const r = "f2000000-0000-0000-0000-000000000001",
    l = "f3000000-0000-0000-0000-000000000001";
  const worker = createApiWorker(undefined, undefined, undefined, undefined, undefined, {
    verify: () => Promise.resolve({ userId: "f1000000-0000-0000-0000-000000000001", aal: "aal2" }),
  });
  const endpoint = `https://api.test/v1/dashboard/restaurants/${r}/locations/${l}/operations`;
  const read = async (command: unknown = null, expected = 200) => {
    const response = await worker.fetch(
      new Request(endpoint, {
        method: command ? "POST" : "GET",
        headers: {
          authorization: "Bearer header.payload.signature",
          "content-type": "application/json",
        },
        ...(command ? { body: JSON.stringify(command) } : {}),
      }),
      env,
    );
    expect(response.status, await response.clone().text()).toBe(expected);
    if (expected !== 200) return null;
    const envelope: unknown = await response.json();
    if (!envelope || typeof envelope !== "object" || !("data" in envelope))
      throw Error("Invalid envelope");
    const state = parseLocationOperationsState(envelope.data);
    expect(state).toBeDefined();
    return state;
  };
  const native = await admin.query<{ data: { data: unknown } }>(
    "select private.location_operations_dashboard($1,'aal2',$2,$3,null) as data",
    ["f1000000-0000-0000-0000-000000000001", r, l],
  );
  expect(
    parseLocationOperationsState(native.rows[0]!.data.data),
    JSON.stringify(native.rows[0]!.data.data),
  ).toBeDefined();
  let state = (await read())!;
  const source = state.currentVersionId;
  state = (await read({
    action: "create_draft",
    sourceVersionId: source,
    reason: "Synthetic integration configuration",
  }))!;
  const v = state.versions[0]!;
  const beforePolicy = state.deliveryPolicyId;
  const configuration = {
    ...v.configuration,
    minimumLeadMinutes: 15,
    defaultOrderCapacity: 10,
    defaultItemCapacity: 100,
    maxOpenOrders: state.openOrders + 1,
    acceptanceMinutes: 7,
  };
  state = (await read({
    action: "save_draft",
    versionId: v.id,
    expectedRevision: v.revision,
    configuration,
    reason: "Synthetic limits",
  }))!;
  await read(
    {
      action: "save_draft",
      versionId: v.id,
      expectedRevision: v.revision,
      configuration,
      reason: "Synthetic stale edit",
    },
    409,
  );
  const publish = {
    action: "publish",
    versionId: v.id,
    expectedRevision: 1,
    expectedPublicationId: state.publicationId,
    expectedDeliveryPolicyId: state.deliveryPolicyId,
    reason: "Synthetic publish",
  };
  // Independent writers compete on the same publication token; one must re-review.
  const published = await Promise.all(
    [0, 1].map(() =>
      worker.fetch(
        new Request(endpoint, {
          method: "POST",
          headers: {
            authorization: "Bearer header.payload.signature",
            "content-type": "application/json",
          },
          body: JSON.stringify(publish),
        }),
        env,
      ),
    ),
  );
  expect(published.map((r) => r.status).sort()).toEqual([200, 409]);
  state = (await read())!;
  expect(state.currentVersionId).toBe(v.id);
  if (beforePolicy) {
    const result = await admin.query<{ old: unknown; current: unknown }>(
      "select (select declaration from private.delivery_tax_declarations where policy_id=$1) as old,(select declaration from private.delivery_tax_declarations where policy_id=$2) as current",
      [beforePolicy, state.deliveryPolicyId],
    );
    expect(result.rows[0]?.current).toEqual(result.rows[0]?.old);
  }
  const time = await admin.query<{ requested_for: string }>(
    "select to_char((date_trunc('hour',statement_timestamp())+interval '40 hours') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as requested_for",
  );
  const request = {
    menuId: "f4000000-0000-0000-0000-000000000001",
    menuVersionId: "f5000000-0000-0000-0000-000000000001",
    requestedFor: time.rows[0]!.requested_for,
    lines: [{ menuItemId: "f6000000-0000-0000-0000-000000000001", quantity: 1 }],
    customer: {
      contactName: "Synthetic Controls",
      phoneE164: "+999100000054",
      email: "synthetic@example.invalid",
    },
    privacyNoticeVersion: "preview-v1",
  };
  const post = (key: string, offset = 0) =>
    worker.fetch(
      new Request(
        "https://api.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte/orders",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...request,
            requestedFor: new Date(Date.parse(request.requestedFor) + offset).toISOString(),
            submissionKey: key,
          }),
        },
      ),
      env,
    );
  const deliveryRequestedFor = new Date(Date.parse(request.requestedFor) + 7200000).toISOString();
  const postalCode = configuration.zones[0]!.postalCodes[0]!;
  const deliveryLines = [{ ...request.lines[0]!, quantity: 2 }];
  const quoteResponse = await worker.fetch(
    new Request(
      "https://api.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte/delivery-quote",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          menuId: request.menuId,
          menuVersionId: request.menuVersionId,
          requestedFor: deliveryRequestedFor,
          lines: deliveryLines,
          postalCode,
        }),
      },
    ),
    env,
  );
  expect(quoteResponse.status, await quoteResponse.clone().text()).toBe(200);
  const quoteEnvelope: { data?: unknown } = await quoteResponse.json();
  const expectedQuote = parseDeliveryQuote(quoteEnvelope.data);
  expect(expectedQuote).toBeDefined();
  const postDelivery = () =>
    worker.fetch(
      new Request(
        "https://api.test/v1/storefront/storefront-restaurant-a/storefront-a-mitte/delivery-orders",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...request,
            requestedFor: deliveryRequestedFor,
            lines: deliveryLines,
            submissionKey: "controls-race-003",
            expectedQuote,
            delivery: {
              addressLine1: "Synthetic Controlsweg 10",
              addressLine2: null,
              postalCode,
              city: "Aachen",
              countryCode: "DE",
            },
          }),
        },
      ),
      env,
    );
  // Different channels, submission keys and slots on independent DB connections share one limit.
  const responses = await Promise.all([
    post("controls-race-001"),
    post("controls-race-002", 3600000),
    postDelivery(),
  ]);
  const raceEvidence = await Promise.all(
    responses.map(async (response) => ({
      status: response.status,
      body: await response.clone().text(),
    })),
  );
  expect(responses.map((response) => response.status).sort(), JSON.stringify(raceEvidence)).toEqual(
    [201, 409, 409],
  );
  const row = await admin.query<{ submission_key: string; id: string }>(
    "select submission_key,id from public.orders where submission_key like 'controls-race-%'",
  );
  expect(row.rows).toHaveLength(1);
  expect(
    (
      await (row.rows[0]!.submission_key.endsWith("003")
        ? postDelivery()
        : post(
            row.rows[0]!.submission_key,
            row.rows[0]!.submission_key.endsWith("002") ? 3600000 : 0,
          ))
    ).status,
  ).toBe(201);
  const clock = await admin.query<{ duration: string }>(
    "select (deadline-started_at)::text as duration from private.order_acceptance_alerts where order_id=$1",
    [row.rows[0]!.id],
  );
  expect(clock.rows[0]?.duration).toBe("00:07:00");
  state = (await read())!;
  const until = new Date(Date.now() + 20 * 60000).toISOString();
  state = (await read({
    action: "override",
    scope: "all",
    expectedSequence: state.operationSequence,
    endsAt: until,
    reason: "Synthetic full pause",
    values: {
      paused: true,
      leadMinutes: null,
      orderCapacity: null,
      itemCapacity: null,
      maxOpenOrders: null,
    },
  }))!;
  state = (await read({
    action: "clear_override",
    scope: "pickup",
    expectedSequence: state.operationSequence,
    reason: "Synthetic channel resume",
  }))!;
  expect(state.overrides.find((v) => v.scope === "all")?.values.paused).toBe(true);
  const paused = await admin.query<{ paused: boolean }>(
    "select private.location_ordering_paused($1,$2,$3,statement_timestamp()) as paused",
    [r, l, "pickup"],
  );
  expect(paused.rows[0]?.paused).toBe(true);
  const expires = await admin.query<{ paused: boolean }>(
    "select private.location_ordering_paused($1,$2,$3,statement_timestamp()+interval '21 minutes') as paused",
    [r, l, "pickup"],
  );
  expect(expires.rows[0]?.paused).toBe(false);
  const beforeAudit = state.audit.length;
  const invalid = {
    action: "save_draft",
    versionId: v.id,
    expectedRevision: 1,
    configuration,
    reason: "Synthetic invalid published edit",
  };
  await read(invalid, 409);
  expect((await read())!.audit.length).toBe(beforeAudit);
  // Scoped authorization is fresh on every operation; synthetic verifier does not bypass database roles.
  await admin.query(
    "update public.restaurant_memberships set status='suspended' where restaurant_id=$1 and user_id='f1000000-0000-0000-0000-000000000001'",
    [r],
  );
  await read(null, 403);
  await admin.query(
    "update public.restaurant_memberships set status='active' where restaurant_id=$1 and user_id='f1000000-0000-0000-0000-000000000001'",
    [r],
  );
  // Restore source schedule deliberately; original order deadlines and snapshots remain intact.
  state = (await read())!;
  await read({
    action: "clear_override",
    scope: "all",
    expectedSequence: state.operationSequence,
    reason: "Synthetic restore",
  });
  state = (await read())!;
  const original = state.versions.find((v) => v.id === source)!;
  await read({
    action: "publish",
    versionId: original.id,
    expectedRevision: original.revision,
    expectedPublicationId: state.publicationId,
    expectedDeliveryPolicyId: state.deliveryPolicyId,
    reason: "Synthetic rollback",
  });
}
