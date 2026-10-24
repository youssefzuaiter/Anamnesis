"use client";

import { Icon } from "@/components/icons";
import { useIsMac } from "@/components/use-is-mac";

export function CommandPaletteTrigger() {
  const isMac = useIsMac();

  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", metaKey: true }),
        )
      }
      className="flex min-h-10 w-full items-center gap-2.5 rounded-xl border border-control bg-surface px-3 text-left text-sm font-medium text-text-faint transition-colors hover:text-text-muted"
    >
      <Icon name="search" />
      <span className="flex-1 truncate">Jump to…</span>
      <kbd
        suppressHydrationWarning
        className="rounded-md border border-border-strong bg-surface-subtle px-1.5 font-sans text-xs font-semibold text-text-faint"
      >
        {isMac ? "⌘" : "Ctrl "}K
      </kbd>
    </button>
  );
}
