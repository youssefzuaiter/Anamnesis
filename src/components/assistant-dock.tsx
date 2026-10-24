"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AssistantChat } from "@/components/assistant-chat";
import { Icon } from "@/components/icons";
import { useIsMac } from "@/components/use-is-mac";

type Dock = { open: boolean; available: boolean; setOpen: (open: boolean) => void };

const DockContext = createContext<Dock | null>(null);

function useDock(): Dock {
  const dock = useContext(DockContext);
  if (!dock) throw new Error("Assistant dock used outside AssistantDockProvider");
  return dock;
}

/** Sends focus back to whichever toggle is on screen, so closing the panel
 *  never strands a keyboard user at the top of the document. */
function focusToggle() {
  for (const id of ["assistant-toggle", "assistant-toggle-fab"]) {
    const element = document.getElementById(id);
    if (element && element.offsetParent !== null) {
      element.focus();
      return;
    }
  }
}

/**
 * The assistant as a panel beside whatever you are looking at, rather than a
 * page you leave your work to visit. It is unavailable on /ai itself, where the
 * full page with its thread history is already showing, so the two can never
 * render the same "Ask your workspace" field twice.
 */
export function AssistantDockProvider({ children }: { children: React.ReactNode }) {
  const [requested, setRequested] = useState(false);
  const pathname = usePathname();
  const available = !(pathname === "/ai" || pathname.startsWith("/ai/"));
  const open = requested && available;
  const setOpen = useCallback((next: boolean) => setRequested(next), []);

  // Closing unmounts the panel, and with it whatever had focus inside it.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) focusToggle();
    wasOpen.current = open;
  }, [open]);

  // ⌘J / Ctrl+J toggles it from anywhere, the way ⌘K opens the palette.
  useEffect(() => {
    if (!available) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setRequested((current) => !current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [available]);

  const value = useMemo(() => ({ open, available, setOpen }), [open, available, setOpen]);
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

export function AssistantToggle({ variant }: { variant: "bar" | "fab" }) {
  const { open, available, setOpen } = useDock();
  const isMac = useIsMac();
  if (!available) return null;

  if (variant === "fab") {
    // Hidden while the panel is open: on a phone the panel covers the screen
    // and has its own close button.
    if (open) return null;
    return (
      <button
        id="assistant-toggle-fab"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask Anamnesis"
        aria-expanded={false}
        aria-controls="assistant-panel"
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-30 inline-flex size-14 items-center justify-center rounded-full bg-ai text-surface shadow-card sm:hidden"
      >
        <Icon name="assistant" className="size-6" />
      </button>
    );
  }

  return (
    <button
      id="assistant-toggle"
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-controls="assistant-panel"
      className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold text-ai transition-colors ${
        open
          ? "border-transparent bg-ai-soft"
          : "border-[color-mix(in_srgb,var(--ai)_38%,var(--border))] bg-surface hover:bg-ai-soft"
      }`}
    >
      <Icon name="assistant" />
      Ask
      <kbd
        suppressHydrationWarning
        className="rounded-md border border-border-strong bg-surface-subtle px-1.5 font-sans text-xs font-semibold text-text-faint"
      >
        {isMac ? "⌘" : "Ctrl "}J
      </kbd>
    </button>
  );
}

export function AssistantPanel() {
  const { open, setOpen } = useDock();
  if (!open) return null;

  return (
    <aside
      id="assistant-panel"
      aria-label="Assistant"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
      className="fixed inset-0 z-40 flex flex-col bg-surface sm:sticky sm:top-0 sm:z-auto sm:h-dvh sm:w-[400px] sm:shrink-0 sm:border-l sm:border-border-subtle"
    >
      <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 pb-3 pt-4">
        <span
          aria-hidden="true"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-ai-soft text-ai"
        >
          <Icon name="assistant" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold leading-tight text-text">Ask Anamnesis</h2>
          <p className="text-xs text-text-faint">Answers only from your own notes and plans</p>
        </div>
        <Link
          href="/ai"
          aria-label="All conversations"
          title="All conversations"
          className="inline-flex size-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-subtle hover:text-text"
        >
          <Icon name="clock" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          className="inline-flex size-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-subtle hover:text-text"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
        <AssistantChat variant="panel" autoFocus />
      </div>
    </aside>
  );
}
