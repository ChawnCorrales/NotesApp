import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * End-to-end configuration.
 *
 * These tests exist for the parts of the product that only work in a real
 * browser: contenteditable, selection, ProseMirror decorations, and IndexedDB
 * surviving an actual page reload. Anything provable without a browser is
 * covered faster by the Vitest projects instead.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Every worker drives the same dev server, so high parallelism mostly buys
  // contention: renders get slow enough that debounced recognition starts
  // racing the assertions. Two is a good trade on a developer machine.
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // Entity recognition is debounced, and saves more so. A slightly generous
    // action timeout keeps the tests honest without making them flaky.
    actionTimeout: 10_000,
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
