import { Client } from "pg";

export async function probeDatabase(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    await client.query("SELECT 1 AS healthy");
  } finally {
    await client.end();
  }
}
