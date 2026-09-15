import { Client } from "pg";
import type { StorefrontReader } from "./storefront.js";

async function read(
  connectionString: string,
  statement: string,
  values: readonly unknown[],
): Promise<unknown> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 6000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL ROLE service_role");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await client.query<{ data: unknown }>(statement, [...values]);
    await client.query("COMMIT");
    if (result.rows.length !== 1) throw new Error("Unexpected public read result");
    return result.rows[0]?.data;
  } finally {
    await client.end();
  }
}

export const postgresStorefrontReader: StorefrontReader = {
  catalog: (connectionString, scope) =>
    read(connectionString, "SELECT private.read_storefront_catalog($1::text, $2::text) AS data", [
      scope.restaurantSlug,
      scope.locationSlug,
    ]),
  availability: (connectionString, query) =>
    read(
      connectionString,
      "SELECT private.read_storefront_availability($1::text, $2::text, $3::text, $4::timestamptz, $5::integer) AS data",
      [
        query.restaurantSlug,
        query.locationSlug,
        query.fulfillmentType,
        query.requestedFor,
        query.itemCount,
      ],
    ),
};
