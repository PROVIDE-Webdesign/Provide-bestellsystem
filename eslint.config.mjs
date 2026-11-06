import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "**/public/asian-kitchen/**",
      "**/output/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    files: ["apps/dashboard/public/dashboard-push-sw.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { self: "readonly", clients: "readonly", URL: "readonly" } },
  },
  // Standalone design fixtures have synthetic transports and no application TS project.
  // Keep recommended syntax checks; deployed app code remains fully type checked.
  {
    files: [
      "apps/dashboard/design-preview/**/*.{ts,tsx}",
      "apps/storefront/design-preview/**/*.{ts,tsx}",
    ],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // Dependency-free browser adapters are plain JavaScript outside the TS project.
  // Keep syntax and recommended lint rules; typed application code remains strict.
  {
    files: ["apps/storefront/demo/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: Object.fromEntries(
        [
          "AbortSignal",
          "Event",
          "FormData",
          "MutationObserver",
          "URL",
          "crypto",
          "document",
          "fetch",
          "matchMedia",
          "queueMicrotask",
          "sessionStorage",
          "window",
        ].map((name) => [name, "readonly"]),
      ),
    },
  },
);
