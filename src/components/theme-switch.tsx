"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/icons";
import {
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
  type ThemePreference,
} from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: "system", label: "System", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

// A same-tab change is announced with this event, since the `storage` event
// only fires in other tabs.
const CHANGE_EVENT = "anamnesis-theme-change";
const SYSTEM_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can be blocked (private windows, site data cleared). The theme
    // then simply follows the system, which is what it does by default.
    return "system";
  }
}

function applyTheme(preference: ThemePreference) {
  const systemDark = window.matchMedia(SYSTEM_QUERY).matches;
  document.documentElement.setAttribute(
    "data-theme",
    resolveTheme(preference, systemDark),
  );
}

function choose(preference: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not stored, but still applied for this page view.
  }
  applyTheme(preference);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  // Another tab changed the choice: apply it here too, then re-render.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyTheme(readPreference());
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const NEXT: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};

/**
 * Lets the reader choose System, Light or Dark. The choice is kept on this
 * browser only. System (the default) follows the operating system, including
 * when it changes while the page is open.
 *
 * `segmented` shows all three options, for places with room. `cycle` is one
 * compact row that shows the current choice and steps to the next, for the
 * narrow sidebar.
 */
export function ThemeSwitch({
  className = "",
  variant = "segmented",
}: {
  className?: string;
  variant?: "segmented" | "cycle";
}) {
  const preference = useSyncExternalStore(
    subscribe,
    readPreference,
    () => "system" as ThemePreference,
  );

  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia(SYSTEM_QUERY);
    const onSystemChange = () => applyTheme("system");
    media.addEventListener("change", onSystemChange);
    return () => media.removeEventListener("change", onSystemChange);
  }, [preference]);

  if (variant === "cycle") {
    const current = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[0];
    return (
      <button
        type="button"
        onClick={() => choose(NEXT[preference])}
        title="Change appearance"
        className={`flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text ${className}`}
      >
        <Icon name={current.icon} />
        <span>Appearance</span>
        <span className="ml-auto text-xs font-semibold text-text-faint">{current.label}</span>
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Appearance"
      className={`inline-flex rounded-xl border border-control bg-surface p-0.5 ${className}`}
    >
      {OPTIONS.map((option) => {
        const active = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => choose(option.value)}
            className={`inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors ${
              active
                ? "bg-accent-soft text-accent-ink"
                : "text-text-muted hover:text-text"
            }`}
          >
            <Icon name={option.icon} className="size-4" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
