import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Next.js resolves `server-only` to an empty module when bundling server
// code. Vitest runs outside the Next.js bundler, so tests map it to the
// same empty module that Next.js ships. This file is test-only and is never
// loaded by `next dev`, `next build` or `next start`.
const serverOnlyEmptyModule = fileURLToPath(
  new URL(
    "./node_modules/next/dist/compiled/server-only/empty.js",
    import.meta.url,
  ),
);

export default defineConfig({
  resolve: {
    // Resolve `@/*` imports from tsconfig.json `paths`.
    tsconfigPaths: true,

    alias: [
      {
        find: /^server-only$/,
        replacement: serverOnlyEmptyModule,
      },
    ],
  },

  test: {
    environment: "node",

    include: [
      "tests/**/*.test.{ts,tsx}",
      "src/**/*.test.{ts,tsx}",
    ],

    // Blocks network access and hides real secrets for every test.
    setupFiles: ["./tests/setup/test-guards.ts"],

    unstubEnvs: true,
    unstubGlobals: true,
  },
});
