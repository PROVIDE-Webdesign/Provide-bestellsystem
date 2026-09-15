import { Client } from "pg";
import type { GuestPickupOrderCommand } from "@provide/contracts";
import type { CheckoutWriter } from "./checkout.js";

export const postgresCheckoutWriter: CheckoutWriter = {
  async submit(connectionString, command, retentionDays) {
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
      const lines = command.lines.map((line) => ({
        menu_item_id: line.menuItemId,
        quantity: line.quantity,
      }));
      const customer = {
        contact_name: command.customer.contactName,
        phone_e164: command.customer.phoneE164,
        email: command.customer.email,
      };
      const result = await client.query<{ data: unknown }>(
        "SELECT private.submit_public_guest_pickup_order($1::text,$2::text,$3::uuid,$4::uuid,$5::timestamptz,$6::jsonb,$7::text,$8::jsonb,$9::text,$10::integer) AS data",
        [
          command.restaurantSlug,
          command.locationSlug,
          command.menuId,
          command.menuVersionId,
          command.requestedFor,
          JSON.stringify(lines),
          command.submissionKey,
          JSON.stringify(customer),
          command.privacyNoticeVersion,
          retentionDays,
        ],
      );
      if (result.rows.length !== 1) throw new Error("Unexpected checkout result");
      await client.query("COMMIT");
      return result.rows[0]?.data;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  },
};

export type { GuestPickupOrderCommand };
