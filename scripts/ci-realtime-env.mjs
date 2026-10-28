// Disposable CI stack only. Never print keys or apply this to a remote/user project.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
if (!process.env.CI || !process.env.GITHUB_ENV) throw Error("CI-only realtime fixture setup");
// The CLI namespaces local Docker containers by the configured project_id.
// Accept only the simple, literal identifier used by this repository and fail closed.
const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
const generalConfig = config.split(/^\s*\[/m)[0];
const projectIds = [
  ...generalConfig.matchAll(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"\s*(?:#.*)?$/gm),
];
if (projectIds.length !== 1) throw Error("Missing or ambiguous local Supabase project_id");
const container = `supabase_realtime_${projectIds[0][1]}`;
const raw = execFileSync("supabase", ["status", "--output", "json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const status = JSON.parse(raw);
const api = status.API_URL ?? status.api_url;
if (!api || new URL(api).hostname !== "127.0.0.1") throw Error("Realtime fixture must be loopback");
const inspected = JSON.parse(
  execFileSync("docker", ["inspect", container], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
const entry = inspected[0]?.Config?.Env?.find((v) => v.startsWith("API_JWT_SECRET="));
const secret = entry?.slice("API_JWT_SECRET=".length);
const publishable = status.ANON_KEY ?? status.anon_key ?? status.PUBLISHABLE_KEY;
const authAdmin = status.SERVICE_ROLE_KEY ?? status.service_role_key ?? status.SECRET_KEY;
if (!secret || !publishable || !authAdmin || /[\r\n]/.test(secret + publishable + authAdmin + api))
  throw Error("Missing isolated realtime credentials");
for (const value of [secret, publishable, authAdmin])
  process.stdout.write(`::add-mask::${value}\n`);
appendFileSync(
  process.env.GITHUB_ENV,
  `TEST_REALTIME_URL=${api}\nTEST_REALTIME_KEY=${publishable}\nTEST_REALTIME_JWT_SECRET=${secret}\nTEST_AUTH_ADMIN_KEY=${authAdmin}\n`,
);
process.stdout.write("Isolated realtime fixture configured; credentials masked.\n");
