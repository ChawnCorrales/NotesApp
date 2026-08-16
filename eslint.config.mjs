import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  /**
   * Components talk to the service layer, never to storage.
   *
   * The boundary is what makes a server implementation possible later, and it
   * only holds if something enforces it — every direct Dexie call in a
   * component is a query that would have to be rewritten, and a place a future
   * permission check could be skipped. Enforced here so the answer arrives at
   * review time rather than during a migration.
   */
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/db/db", "**/lib/db/db", "dexie"],
              message:
                "Components must not use Dexie directly. Add an operation to src/lib/services and call that instead.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
