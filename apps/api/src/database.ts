import { Client } from "pg";

export async function probeDatabase(connectionString: string): Promise<void> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 3000,
    query_timeout: 3000,
  });

  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '2500ms'");
    await client.query("SELECT 1 AS healthy");
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}
