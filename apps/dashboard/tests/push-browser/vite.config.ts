import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      "@provide/contracts": fileURLToPath(
        new URL("../../../../packages/contracts/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4197,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../../..", import.meta.url))] },
  },
});
