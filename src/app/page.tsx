"use client";

/**
 * Everything below this point is client-only.
 *
 * The whole app reads from IndexedDB, which does not exist on the server, so
 * there is nothing meaningful to prerender. Gating on a mounted flag avoids
 * hydration mismatches between an empty server render and a database-backed
 * client one.
 */

import { useSyncExternalStore } from "react";
import { AppShell } from "@/components/AppShell";
import { CampaignProvider } from "@/components/campaign-context";
import { NavigationProvider } from "@/components/navigation-context";

/** Never fires; the value is constant per environment. */
const subscribe = () => () => {};

export default function Page() {
  // Reads false during the server render and true on the client, without the
  // extra render pass a mount flag in an effect would cost.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  if (!mounted) {
    return (
      <main className="flex h-screen items-center justify-center text-ink-faint">
        Opening the archive…
      </main>
    );
  }

  return (
    <CampaignProvider>
      <NavigationProvider>
        <AppShell />
      </NavigationProvider>
    </CampaignProvider>
  );
}
