import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const output = process.argv[2];
if (!output || process.argv.length !== 3) {
  throw new Error("Pass a new output directory for the closed production rehearsal");
}

const repository = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = resolve(output);
mkdirSync(outputDirectory, { mode: 0o700 });

for (const app of ["api", "dashboard", "storefront"]) {
  const appDirectory = resolve(repository, "apps", app);
  const source = resolve(
    appDirectory,
    app === "api" ? "wrangler.jsonc" : "dist/server/wrangler.json",
  );
  const { config, error } = ts.parseConfigFileTextToJson(source, readFileSync(source, "utf8"));
  if (error || config.name !== `provide-bs-${app}-preview` || !config.main)
    throw new Error(`Unexpected source configuration for ${app}`);

  // Reuse the tested entry points and build settings. Bindings, origins, routes,
  // triggers and preview values are supplied separately for the production account.
  let assetsDirectory = config.assets
    ? resolve(dirname(source), config.assets.directory)
    : undefined;
  if (app === "storefront" && assetsDirectory) {
    const demoDirectory = resolve(assetsDirectory, "asian-kitchen");
    const productionAssets = resolve(outputDirectory, "storefront-assets");
    cpSync(assetsDirectory, productionAssets, {
      recursive: true,
      filter: (path) => path !== demoDirectory,
    });
    assetsDirectory = productionAssets;
  }
  const production = {
    name: `provide-bs-${app}-production`,
    main: resolve(dirname(source), config.main),
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags,
    workers_dev: false,
    preview_urls: false,
    observability: { enabled: true },
    vars: {
      APP_ENV: "production",
      ...(app === "api"
        ? {
            CHECKOUT_PROTECTION_ENABLED: "false",
            CHECKOUT_WRITE_ENABLED: "false",
            HYPERDRIVE_CACHE_DISABLED: "false",
            ONLINE_PAYMENT_ENABLED: "false",
            ONLINE_PAYMENT_PROCESSING_ENABLED: "false",
            ONLINE_LIVE_PAYMENT_ENABLED: "false",
            ONLINE_LIVE_PAYMENT_PROCESSING_ENABLED: "false",
            EMAIL_DISPATCH_ENABLED: "false",
          }
        : app === "storefront"
          ? {
              CHECKOUT_PROTECTION_ENABLED: "false",
              PUBLIC_ONLINE_PAYMENT_ENABLED: "false",
              PUBLIC_LIVE_ONLINE_PAYMENT_ENABLED: "false",
              ASIAN_KITCHEN_DEMO_ENABLED: "false",
            }
          : { DASHBOARD_AUTH_ENABLED: "false", DASHBOARD_REALTIME_ENABLED: "false" }),
    },
    ...(config.assets
      ? {
          assets: {
            ...config.assets,
            directory: assetsDirectory,
          },
          rules: config.rules,
          no_bundle: config.no_bundle,
          cache: config.cache,
        }
      : {}),
  };

  writeFileSync(
    resolve(outputDirectory, `${app}.json`),
    JSON.stringify(production, null, 2) + "\n",
    {
      flag: "wx",
      mode: 0o600,
    },
  );
}
