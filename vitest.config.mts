import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Named `.mts` deliberately.
 *
 * The package is CommonJS, so Vite would load a `.ts` config through
 * `require()`, and several of Vitest's own dependencies are ESM-only. Node
 * 20.19+ can require an ES module; 20.18 — the version this project is
 * developed on — cannot. The explicit ESM extension sidesteps the difference
 * rather than depending on the developer's Node patch version.
 *
 * Three projects, because the layers under test need genuinely different
 * environments, and running them separately keeps the fast ones fast:
 *
 *  unit         pure functions (matching, position mapping). No DOM, no storage.
 *  integration  repository behaviour against a real IndexedDB implementation.
 *  component    React components in jsdom.
 *
 * ProseMirror behaviour is deliberately absent here: an editor faked in jsdom
 * tests the fake. Everything depending on real layout, selection, and
 * contenteditable is covered by Playwright instead.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Declared here rather than derived from tsconfig: the test files live
      // outside the app's tsconfig `include`, so a paths plugin would not apply
      // the alias to them.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          // fake-indexeddb gives Dexie a real IndexedDB implementation, so
          // these exercise the actual queries and transactions rather than a
          // hand-written stand-in that could drift from Dexie's semantics.
          setupFiles: ["./tests/setup/indexeddb.ts"],
          include: ["tests/integration/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          // Markdown import goes through DOMParser and TipTap's HTML parse
          // rules, so it needs a DOM - but it is plain logic, not a component.
          // Storage is available too, so importing into the database is covered
          // here rather than split across two projects.
          environment: "happy-dom",
          setupFiles: ["./tests/setup/indexeddb.ts"],
          include: ["tests/dom/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          // happy-dom rather than jsdom: jsdom's CSS colour dependency is
          // ESM-only and cannot be `require()`d on Node < 20.19, which is the
          // version this project is developed on. happy-dom is ESM-native and
          // sufficient for these components — none of them measure layout.
          environment: "happy-dom",
          setupFiles: ["./tests/setup/component.ts"],
          include: ["tests/component/**/*.test.tsx"],
        },
      },
    ],
  },
});
