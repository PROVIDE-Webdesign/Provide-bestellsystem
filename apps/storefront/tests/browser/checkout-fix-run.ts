import { verifyCheckoutProtectionBrowser } from "./checkout-protection.ts";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
const output = "/root/provide-bs-checkout-fix/browser";
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("./", import.meta.url)),
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("../../../dashboard/", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 4321,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../../../", import.meta.url))] },
  },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  await verifyCheckoutProtectionBrowser(browser, output);
  console.log("PASS: 14 desktop/mobile checkout recovery scenarios");
} finally {
  await browser.close();
  await server.close();
}
