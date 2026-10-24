"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * Whether to show ⌘ or Ctrl in shortcut hints. The server has no navigator, so
 * it renders Ctrl until the client snapshot takes over; useSyncExternalStore
 * gives that without a setState-in-effect cascade. Elements that print the
 * result need `suppressHydrationWarning`, since the two renders legitimately
 * differ.
 */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => navigator.platform.toLowerCase().includes("mac"),
    () => false,
  );
}
