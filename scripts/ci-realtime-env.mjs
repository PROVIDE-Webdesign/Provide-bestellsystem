// Disposable CI stack only. Never print keys or apply this to a remote/user project.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
if (!process.env.CI || !process.env.GITHUB_ENV) throw Error("CI-only realtime fixture setup");
const raw = execFileSync("supabase", ["status", "--output", "json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const status = JSON.parse(raw);
const api = status.API_URL ?? status.api_url;
if (!api || new URL(api).hostname !== "127.0.0.1") throw Error("Realtime fixture must be loopback");
const inspected = JSON.parse(
  execFileSync("docker", ["inspect", "supabase_realtime_provide-bestellsystem-local"], {
    encoding: "utf8",
  }),
);
const entry = inspected[0]?.Config?.Env?.find((v) => v.startsWith("API_JWT_SECRET="));
const secret = entry?.slice("API_JWT_SECRET=".length);
const publishable = status.ANON_KEY ?? status.anon_key ?? status.PUBLISHABLE_KEY;
if (!secret || !publishable || /[\r\n]/.test(secret + publishable + api))
  throw Error("Missing isolated realtime credentials");
for (const value of [secret, publishable]) process.stdout.write(`::add-mask::${value}\n`);
appendFileSync(
  process.env.GITHUB_ENV,
  `TEST_REALTIME_URL=${api}\nTEST_REALTIME_KEY=${publishable}\nTEST_REALTIME_JWT_SECRET=${secret}\n`,
);
process.stdout.write("Isolated realtime fixture configured; credentials masked.\n");
