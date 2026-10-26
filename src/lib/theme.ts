/**
 * Which appearance the interface uses. `system` follows the operating system
 * and is the default; `light` and `dark` override it on this browser.
 *
 * Pure on purpose: the page's first-paint script (src/app/layout.tsx) and the
 * switch component both use these rules, and this file is what the unit tests
 * check. The script inlines the same logic, since it cannot import from here.
 */
export const THEME_STORAGE_KEY = "anamnesis-theme";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

/** Anything that is not an explicit override (including a missing or corrupt
 *  value) means `system`. */
export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "light" || preference === "dark") return preference;
  return systemPrefersDark ? "dark" : "light";
}
