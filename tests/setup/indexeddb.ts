/**
 * Gives Node a real IndexedDB implementation for the integration project.
 *
 * Imported for its side effects only — it installs the globals Dexie looks for
 * at connection time.
 */
import "fake-indexeddb/auto";
