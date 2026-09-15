import { Client } from "pg";
import type { DeliveryRepository } from "./delivery.js";

async function query(connectionString: string, sql: string, values: readonly unknown[]) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 9000,
  });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    await client.query("SET LOCAL statement_timeout = '8s'");
    const result = await client.query<{ data: unknown }>(sql, [...values]);
    if (result.rows.length !== 1) throw new Error("Invalid delivery result");
    await client.query("COMMIT");
    return result.rows[0]?.data;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
export const postgresDeliveryRepository: DeliveryRepository = {
  quote(connectionString, scope, command) {
    return query(
      connectionString,
      "SELECT private.quote_public_delivery_order($1::text,$2::text,$3::uuid,$4::uuid,$5::timestamptz,$6::jsonb,$7::text) AS data",
      [
        scope.restaurantSlug,
        scope.locationSlug,
        command.menuId,
        command.menuVersionId,
        command.requestedFor,
        JSON.stringify(
          command.lines.map((l) => ({ menu_item_id: l.menuItemId, quantity: l.quantity })),
        ),
        command.postalCode,
      ],
    );
  },
  submit(connectionString, scope, command, retentionDays) {
    const d = command.delivery;
    return query(
      connectionString,
      "SELECT private.submit_public_guest_delivery_order($1::text,$2::text,$3::uuid,$4::uuid,$5::timestamptz,$6::jsonb,$7::text,$8::jsonb,$9::jsonb,$10::jsonb,$11::text,$12::integer) AS data",
      [
        scope.restaurantSlug,
        scope.locationSlug,
        command.menuId,
        command.menuVersionId,
        command.requestedFor,
        JSON.stringify(
          command.lines.map((l) => ({ menu_item_id: l.menuItemId, quantity: l.quantity })),
        ),
        command.submissionKey,
        JSON.stringify({
          contact_name: command.customer.contactName,
          phone_e164: command.customer.phoneE164,
          email: command.customer.email,
        }),
        JSON.stringify({
          address_line_1: d.addressLine1,
          address_line_2: d.addressLine2,
          postal_code: d.postalCode,
          city: d.city,
          country_code: d.countryCode,
        }),
        JSON.stringify(command.expectedQuote),
        command.privacyNoticeVersion,
        retentionDays,
      ],
    );
  },
};
