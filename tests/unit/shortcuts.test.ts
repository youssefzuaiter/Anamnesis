import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANYWHERE_SHORTCUTS,
  GO_TO_PREFIX,
  GO_TO_SHORTCUTS,
  SEQUENCE_TIMEOUT_MS,
  isTypingTarget,
  parseShortcutsPreference,
} from "@/lib/shortcuts";
import { MOBILE_MORE, NAV_GROUPS } from "@/components/nav-items";

test("the go-to keys are the ones in the design", () => {
  assert.deepEqual(
    GO_TO_SHORTCUTS.map((s) => `${s.key} ${s.href}`),
    ["h /", "n /notes", "s /search", "t /tasks", "c /calendar", "p /projects", "g /goals",
     "u /courses", "d /cards", "r /review", "f /focus", "a /audit", "x /trash", ", /settings", "i /ai"],
  );
});

test("every key is one lower-case character and unique, and never the prefix's own meaning", () => {
  const keys = GO_TO_SHORTCUTS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.equal(key.length, 1);
  assert.ok(!keys.includes("?")); // ? is the help key
  assert.equal(GO_TO_PREFIX, "g");
  assert.equal(SEQUENCE_TIMEOUT_MS, 1500);
});

test("every sidebar destination has a key with the same label, so a new sidebar item needs one", () => {
  const nav = [...NAV_GROUPS.flatMap((g) => g.items), ...MOBILE_MORE.filter((i) => i.href === "/ai")];
  for (const item of nav) {
    const shortcut = GO_TO_SHORTCUTS.find((s) => s.href === item.href);
    assert.ok(shortcut, `no key for ${item.href}`);
    assert.equal(shortcut.label, item.label);
  }
  for (const s of GO_TO_SHORTCUTS) assert.ok(nav.some((i) => i.href === s.href), `${s.href} is not a destination`);
});

test("the anywhere list names the four always-on keys", () => {
  assert.deepEqual(ANYWHERE_SHORTCUTS.map((s) => s.keys.join(" ")), ["⌘ K", "⌘ J", "?", "Esc"]);
});

test("text boxes, selects and editable regions are typing targets", () => {
  for (const target of [
    { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "INPUT" }, { tagName: "INPUT", type: "text" },
    { tagName: "INPUT", type: "search" }, { tagName: "INPUT", type: "email" }, { tagName: "INPUT", type: "password" },
    { tagName: "INPUT", type: "number" }, { tagName: "DIV", isContentEditable: true },
    { tagName: "DIV", role: "textbox" }, { tagName: "DIV", role: "combobox" }, { tagName: "DIV", role: "searchbox" },
  ]) assert.equal(isTypingTarget(target), true, JSON.stringify(target));
});

test("buttons, links, checkboxes and the page itself are not typing targets", () => {
  for (const target of [
    null, { tagName: "BODY" }, { tagName: "BUTTON" }, { tagName: "A" }, { tagName: "DIV" },
    { tagName: "INPUT", type: "checkbox" }, { tagName: "INPUT", type: "radio" }, { tagName: "INPUT", type: "button" },
    { tagName: "INPUT", type: "submit" }, { tagName: "INPUT", type: "range" }, { tagName: "INPUT", type: "file" },
  ]) assert.equal(isTypingTarget(target), false, JSON.stringify(target));
});

test("the preference is on unless it was explicitly turned off", () => {
  assert.equal(parseShortcutsPreference("off"), false);
  for (const value of ["on", "", "OFF", "false", "0", null, undefined]) assert.equal(parseShortcutsPreference(value), true, String(value));
});
