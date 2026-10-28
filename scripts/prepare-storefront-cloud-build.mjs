/** Preserve the already configured preview runtime when Workers Builds deploys source from Git. */
import { readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const previewWorker = "provide-bs-storefront-preview";
export const previewAccount = "46a54934872edeb8dc9197e1810aee86";

export function preservePreviewRuntime(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.name !== previewWorker)
    throw Error("Wrong Worker. This command is restricted to the existing storefront preview.");
  if (input.account_id && input.account_id !== previewAccount)
    throw Error("Wrong Cloudflare account.");
  if (input.env && Object.keys(input.env).length)
    throw Error("Use a generated single-environment deployment configuration.");
  if (
    !input.compatibility_flags?.includes("nodejs_compat") ||
    !input.compatibility_flags?.includes("global_fetch_strictly_public")
  )
    throw Error("The existing preview compatibility flags are required.");
  if (typeof input.main !== "string" || !input.main || typeof input.assets?.directory !== "string")
    throw Error("Build the complete storefront before preparing deployment.");
  return { ...input, account_id: previewAccount, vars: {}, keep_vars: true };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const configFile = path.join(root, "apps/storefront/dist/server/wrangler.json");
  const original = JSON.parse(await readFile(configFile, "utf8"));
  const ready = preservePreviewRuntime(original);
  if (
    process.env.WRANGLER_CI_OVERRIDE_NAME &&
    process.env.WRANGLER_CI_OVERRIDE_NAME !== previewWorker
  )
    throw Error("Workers Builds selected a different Worker.");
  const compiled = path.resolve(path.dirname(configFile), ready.main);
  const assets = path.resolve(path.dirname(configFile), ready.assets.directory);
  const dist = path.join(root, "apps/storefront/dist") + path.sep;
  if (!compiled.startsWith(dist) || !assets.startsWith(dist))
    throw Error("Build output must stay inside the storefront dist directory.");
  if (!(await stat(compiled)).isFile() || !(await stat(assets)).isDirectory())
    throw Error("Incomplete storefront build.");
  if (!(await stat(path.join(assets, "asian-kitchen/index.html"))).isFile())
    throw Error("The Asian Kitchen build assets are missing.");
  await writeFile(configFile, JSON.stringify(ready, null, 2) + "\n");
  console.log(
    JSON.stringify({
      worker: previewWorker,
      status: "ready",
      runtimeVariables:
        "preserved from existing Cloudflare preview; no repository placeholders deployed",
      secrets: "unchanged",
    }),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
