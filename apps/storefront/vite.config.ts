import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { defineConfig } from "vite";
import vinext from "vinext";

const cdnCache = cdnAdapter();

export default defineConfig({
  plugins: [
    vinext({
      cache: {
        cdn: {
          adapter: cdnCache.adapter,
        },
      },
    }),
    cloudflare({
      viteEnvironment: {
        childEnvironments: ["ssr"],
        name: "rsc",
      },
    }),
  ],
});
