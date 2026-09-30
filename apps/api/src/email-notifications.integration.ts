import { expect } from "vitest";
import type { Client } from "pg";
import { dispatchEmailNotifications, type EmailEnvironment } from "./email-notifications.js";
import { postgresEmailRepository } from "./email-notifications-database.js";
import { createSyntheticEmailAdapter } from "./synthetic-email.js";
import { postgresDashboardOrdersReader } from "./dashboard-orders-database.js";

export async function verifyEmailIntegration(
  admin: Client,
  env: EmailEnvironment & { ORDER_STATUS_TOKEN_SECRET: string },
) {
  const scope = {
    restaurantId: "f2000000-0000-0000-0000-000000000001",
    locationId: "f3000000-0000-0000-0000-000000000001",
  };
  const identity = { userId: "f1000000-0000-0000-0000-000000000001", aal: "aal2" as const };
  const { rows } = await admin.query<{ data: { orderId: string } }>(
    "select private.submit_public_guest_pickup_order($1,$2,$3,$4,date_trunc('hour',now())+interval '4 hours',$5::jsonb,$6,$7::jsonb,$8,30) as data",
    [
      "storefront-restaurant-a",
      "storefront-a-mitte",
      "f4000000-0000-0000-0000-000000000001",
      "f5000000-0000-0000-0000-000000000001",
      JSON.stringify([{ menu_item_id: "f6000000-0000-0000-0000-000000000001", quantity: 1 }]),
      "email-integration-0001",
      JSON.stringify({
        contact_name: "Synthetic Email",
        phone_e164: "+999100000001",
        email: "synthetic@example.invalid",
      }),
      "preview-v1",
    ],
  );
  const orderId = rows[0]!.data.orderId;
  const adapter = createSyntheticEmailAdapter();
  const emailEnv = {
    ...env,
    EMAIL_DISPATCH_ENABLED: "true",
    EMAIL_STOREFRONT_ORIGIN: "https://store.test",
    HYPERDRIVE_CACHE_DISABLED: "true",
  };
  await dispatchEmailNotifications(emailEnv, postgresEmailRepository, adapter, {
    error: () => {
      throw new Error("Email dispatch failed");
    },
  });
  const ledger = await admin.query<{ id: string; status: string; provider_reference: string }>(
    "select id,status,provider_reference from private.email_deliveries where order_id=$1 and template_key='order_submitted'",
    [orderId],
  );
  expect(ledger.rows[0]?.status).toBe("accepted");
  const count = adapter.acceptedCount();
  await dispatchEmailNotifications(emailEnv, postgresEmailRepository, adapter, {
    error: () => {
      throw new Error("Email dispatch failed");
    },
  });
  expect(adapter.acceptedCount()).toBe(count);
  await admin.query(
    "select private.record_email_delivery_receipt($1,$2,'delivered',statement_timestamp())",
    [ledger.rows[0]!.id, ledger.rows[0]!.provider_reference],
  );
  await postgresDashboardOrdersReader.transition(
    env.HYPERDRIVE!.connectionString,
    identity,
    { ...scope, orderId },
    { expectedStatus: "submitted", targetStatus: "accepted" },
  );
  const detail = await admin.query<{
    data: { data: { communication: { confirmedFor: string; revision: number } } };
  }>("select private.read_dashboard_order($1,$2,$3,$4,$5) as data", [
    identity.userId,
    identity.aal,
    scope.restaurantId,
    scope.locationId,
    orderId,
  ]);
  const communication = detail.rows[0]!.data.data.communication;
  expect(communication.confirmedFor).toBeTruthy();
  const time = new Date(Date.parse(communication.confirmedFor) + 15 * 60 * 1000).toISOString();
  expect(
    await postgresDashboardOrdersReader.communicate!(
      env.HYPERDRIVE!.connectionString,
      identity,
      { ...scope, orderId },
      {
        action: "confirm_time",
        expectedStatus: "accepted",
        expectedRevision: communication.revision,
        confirmedFor: time,
      },
    ),
  ).toMatchObject({ outcome: "updated" });
  expect(
    await postgresDashboardOrdersReader.communicate!(
      env.HYPERDRIVE!.connectionString,
      identity,
      { ...scope, orderId },
      {
        action: "confirm_time",
        expectedStatus: "accepted",
        expectedRevision: communication.revision,
        confirmedFor: time,
      },
    ),
  ).toMatchObject({ outcome: "conflict" });
  await dispatchEmailNotifications(emailEnv, postgresEmailRepository, adapter, {
    error: () => {
      throw new Error("Email dispatch failed");
    },
  });
  const sent = await admin.query<{ template_key: string; status: string }>(
    "select template_key,status from private.email_deliveries where order_id=$1 order by created_at,id",
    [orderId],
  );
  expect(sent.rows).toEqual(
    expect.arrayContaining([
      { template_key: "order_submitted", status: "delivered" },
      { template_key: "order_accepted", status: "suppressed" },
      { template_key: "order_time_changed", status: "accepted" },
    ]),
  );
  // Two real database jobs in one claim: a malformed projection must not lose its valid neighbor.
  const create = async (key: string, hours: number) => {
    const result = await admin.query<{ data: { orderId: string } }>(
      "select private.submit_public_guest_pickup_order($1,$2,$3,$4,date_trunc('hour',now())+make_interval(hours=>$5::integer),$6::jsonb,$7,$8::jsonb,$9,30) as data",
      [
        "storefront-restaurant-a",
        "storefront-a-mitte",
        "f4000000-0000-0000-0000-000000000001",
        "f5000000-0000-0000-0000-000000000001",
        hours,
        JSON.stringify([{ menu_item_id: "f6000000-0000-0000-0000-000000000001", quantity: 1 }]),
        key,
        JSON.stringify({
          contact_name: "Synthetic",
          phone_e164: "+999100000001",
          email: "synthetic@example.invalid",
        }),
        "preview-v1",
      ],
    );
    return result.rows[0]!.data.orderId;
  };
  const invalidOrder = await create("email-invalid-projection-0001", 11);
  const validOrder = await create("email-valid-projection-0001", 12);
  // Fault injection beyond the strict JS amount bound, while retaining the row's trusted lease identity.
  await admin.query(
    "update private.email_deliveries set refund_amount_minor=10000000000001 where order_id=$1",
    [invalidOrder],
  );
  const before = adapter.acceptedCount();
  await dispatchEmailNotifications(emailEnv, postgresEmailRepository, adapter, {
    error: () => {
      throw new Error("Email dispatch failed");
    },
  });
  expect(adapter.acceptedCount()).toBe(before + 1);
  const isolated = await admin.query<{
    order_id: string;
    status: string;
    last_error_code: string | null;
  }>(
    "select order_id,status,last_error_code from private.email_deliveries where order_id=any($1::uuid[])",
    [[invalidOrder, validOrder]],
  );
  expect(isolated.rows).toEqual(
    expect.arrayContaining([
      { order_id: invalidOrder, status: "dead_letter", last_error_code: "invalid_projection" },
      { order_id: validOrder, status: "accepted", last_error_code: null },
    ]),
  );
  // Model provider acceptance whose local completion was lost, then corrupt rendering metadata.
  const original = await admin.query<{ display_name: string }>(
    "select display_name from public.restaurants where id=$1",
    [scope.restaurantId],
  );
  await admin.query(
    "update private.email_deliveries set status='uncertain',available_at=statement_timestamp(),last_error_code='provider_timeout' where order_id=$1",
    [validOrder],
  );
  await admin.query(
    "update public.restaurants set display_name=E'Invalid\\nmetadata' where id=$1",
    [scope.restaurantId],
  );
  try {
    await dispatchEmailNotifications(emailEnv, postgresEmailRepository, adapter, {
      error: () => {
        throw new Error("Email reconciliation failed");
      },
    });
    expect(adapter.acceptedCount()).toBe(before + 1);
    const reconciled = await admin.query<{ status: string }>(
      "select status from private.email_deliveries where order_id=$1",
      [validOrder],
    );
    expect(reconciled.rows[0]!.status).toBe("accepted");
  } finally {
    await admin.query("update public.restaurants set display_name=$2 where id=$1", [
      scope.restaurantId,
      original.rows[0]!.display_name,
    ]);
  }
}
