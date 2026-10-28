"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { KEYCAP_CLASS, ShortcutsSheet } from "@/components/shortcuts-sheet";
import {
  GO_TO_SHORTCUTS,
  SEQUENCE_TIMEOUT_MS,
  SHORTCUTS_STORAGE_KEY,
  interpretKey,
  isTypingTarget,
  parseShortcutsPreference,
  type TargetDescriptor,
} from "@/lib/shortcuts";

// The on/off choice is kept on this browser only, like the theme's. A same-tab
// change is announced with this event, since `storage` only fires in other tabs.
const CHANGE_EVENT = "anamnesis-shortcuts-change";

// Only used when storage is blocked (private windows, site data cleared): the
// switch then still works for this page view instead of silently doing nothing.
let memoryChoice: boolean | null = null;

function readEnabled(): boolean {
  try {
    return parseShortcutsPreference(localStorage.getItem(SHORTCUTS_STORAGE_KEY));
  } catch {
    return memoryChoice ?? true;
  }
}

function writeEnabled(enabled: boolean) {
  memoryChoice = enabled;
  try {
    localStorage.setItem(SHORTCUTS_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Not stored, but kept in memory above for this page view.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SHORTCUTS_STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function describe(target: EventTarget | null): TargetDescriptor | null {
  if (!(target instanceof HTMLElement)) return null;
  return {
    tagName: target.tagName,
    type: target instanceof HTMLInputElement ? target.type : undefined,
    isContentEditable: target.isContentEditable,
    role: target.getAttribute("role"),
  };
}

type ShortcutsContextValue = { openSheet: () => void };

const ShortcutsContext = createContext<ShortcutsContextValue>({ openSheet: () => {} });

export function useShortcuts(): ShortcutsContextValue {
  return useContext(ShortcutsContext);
}

/** The sidebar's way into the cheat-sheet, for people who do not know `?`. */
export function ShortcutsButton() {
  const { openSheet } = useShortcuts();
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={openSheet}
      className="flex min-h-9 w-full items-center justify-between gap-2.5 rounded-lg px-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
    >
      <span className="flex items-center gap-2.5">
        <Icon name="keyboard" />
        Keyboard shortcuts
      </span>
      <kbd className={KEYCAP_CLASS}>?</kbd>
    </button>
  );
}

// A few of the commonest destinations, with the table's own labels so they
// cannot drift, then the two keys that leave the hint.
const HINT_KEYS = [
  ...GO_TO_SHORTCUTS.filter((shortcut) => ["n", "t", "c"].includes(shortcut.key)),
  { key: "?", label: "All keys" },
  { key: "Esc", label: "Cancel" },
];

/**
 * Listens for the go-to shortcuts and `?` once, for the whole dashboard, and
 * owns the cheat-sheet and the hint shown while `g` is waiting. The rules for
 * what a key means are in `lib/shortcuts.ts`; this only wires them to the page.
 */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => true);

  const [waiting, setWaiting] = useState(false);
  const waitingSince = useRef<number | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);

  const openSheet = useCallback(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;

      const now = Date.now();
      const { action, armedAt } = interpretKey(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          repeat: event.repeat,
          isComposing: event.isComposing,
        },
        {
          enabled,
          typing: isTypingTarget(describe(event.target)),
          modalOpen: document.querySelector('dialog[open], [aria-modal="true"]') !== null,
        },
        waitingSince.current,
        now,
      );

      waitingSince.current = armedAt;
      window.clearTimeout(hideTimer.current);
      if (armedAt === null) {
        setWaiting(false);
      } else {
        setWaiting(true);
        // The rules already ignore a stale g; this just takes the hint away, at
        // the time g was pressed plus the timeout, even if a modifier key was
        // pressed in between.
        hideTimer.current = window.setTimeout(() => {
          waitingSince.current = null;
          setWaiting(false);
        }, Math.max(0, SEQUENCE_TIMEOUT_MS - (now - armedAt)));
      }

      if (action.type === "go") {
        event.preventDefault();
        if (action.href !== pathname) router.push(action.href);
      } else if (action.type === "help") {
        event.preventDefault();
        openSheet();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(hideTimer.current);
    };
  }, [enabled, pathname, router, openSheet]);

  const value = useMemo(() => ({ openSheet }), [openSheet]);

  return (
    <ShortcutsContext.Provider value={value}>
      {children}

      {/* Always mounted, so a screen reader announces the hint when it fills in. */}
      <div
        role="status"
        className={
          waiting
            ? "fixed bottom-20 left-4 z-40 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-x-4 gap-y-2.5 rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-[13px] shadow-card sm:bottom-6 sm:left-[17rem]"
            : "sr-only"
        }
      >
        {waiting && (
          <>
            <span className="flex items-center gap-2 font-bold text-text">
              <kbd className={`${KEYCAP_CLASS} text-text`}>g</kbd>
              Go to…
            </span>
            {HINT_KEYS.map((hint) => (
              <span key={hint.key} className="flex items-center gap-1.5 text-text-muted">
                <kbd className={`${KEYCAP_CLASS} text-text`}>{hint.key}</kbd>
                {hint.label}
              </span>
            ))}
          </>
        )}
      </div>

      <ShortcutsSheet
        ref={dialog}
        enabled={enabled}
        onToggle={() => writeEnabled(!enabled)}
      />
    </ShortcutsContext.Provider>
  );
}
