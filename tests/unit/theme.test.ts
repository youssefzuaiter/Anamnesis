import { test } from "node:test";
import assert from "node:assert/strict";
import { parseThemePreference, resolveTheme } from "@/lib/theme";

test("only an explicit light or dark overrides the system setting", () => {
  assert.equal(parseThemePreference("light"), "light");
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(parseThemePreference("system"), "system");
});

test("a missing or corrupt stored value means system, never a guessed theme", () => {
  assert.equal(parseThemePreference(null), "system");
  assert.equal(parseThemePreference(undefined), "system");
  assert.equal(parseThemePreference(""), "system");
  assert.equal(parseThemePreference("DARK"), "system");
  assert.equal(parseThemePreference("blue"), "system");
});

test("system follows the operating system in both directions", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("an explicit override ignores the operating system", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});
