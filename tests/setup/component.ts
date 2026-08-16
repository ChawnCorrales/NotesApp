// Components read through Dexie, which needs an IndexedDB implementation even
// in jsdom.
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Components under test render into a shared document; without this a query in
// one test can match a node left behind by the previous one.
afterEach(() => {
  cleanup();
});
