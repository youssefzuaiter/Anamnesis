import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANYWHERE_SHORTCUTS,
  GO_TO_PREFIX,
  GO_TO_SHORTCUTS,
  SEQUENCE_TIMEOUT_MS,
  interpretKey,
  isTypingTarget,
  parseShortcutsPreference,
  type KeyInput,
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

const press = (key: string, over: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  ...over,
});
const ok = { enabled: true, typing: false, modalOpen: false };

test("g arms, then a go-to key goes there and disarms", () => {
  const armed = interpretKey(press("g"), ok, null, 1000);
  assert.deepEqual(armed, { action: { type: "arm" }, armedAt: 1000 });
  assert.deepEqual(interpretKey(press("n"), ok, 1000, 1400), { action: { type: "go", href: "/notes" }, armedAt: null });
  assert.deepEqual(interpretKey(press(","), ok, 1000, 1400), { action: { type: "go", href: "/settings" }, armedAt: null });
});

test("g then g is Goals, and a capital G from caps lock still arms", () => {
  assert.deepEqual(interpretKey(press("g"), ok, 1000, 1200).action, { type: "go", href: "/goals" });
  assert.equal(interpretKey(press("G"), ok, null, 1000).action.type, "arm");
});

test("every go-to key reaches its own page", () => {
  for (const s of GO_TO_SHORTCUTS) assert.deepEqual(interpretKey(press(s.key), ok, 0, 10).action, { type: "go", href: s.href });
});

test("an unknown key after g cancels without going anywhere", () => {
  assert.deepEqual(interpretKey(press("z"), ok, 1000, 1200), { action: { type: "cancel" }, armedAt: null });
  assert.deepEqual(interpretKey(press("Escape"), ok, 1000, 1200), { action: { type: "cancel" }, armedAt: null });
  assert.deepEqual(interpretKey(press("Tab"), ok, 1000, 1200), { action: { type: "cancel" }, armedAt: null });
});

test("g, a long pause, then n does nothing", () => {
  assert.deepEqual(interpretKey(press("n"), ok, 1000, 1000 + SEQUENCE_TIMEOUT_MS), { action: { type: "go", href: "/notes" }, armedAt: null }); // exactly on time still works
  assert.deepEqual(interpretKey(press("n"), ok, 1000, 1000 + SEQUENCE_TIMEOUT_MS + 1), { action: { type: "none" }, armedAt: null });
  assert.equal(interpretKey(press("g"), ok, 1000, 5000).action.type, "arm"); // an expired g can start over
});

test("? opens the list, armed or not", () => {
  assert.deepEqual(interpretKey(press("?", { shiftKey: true }), ok, null, 1), { action: { type: "help" }, armedAt: null });
  assert.deepEqual(interpretKey(press("?", { shiftKey: true }), ok, 1, 100), { action: { type: "help" }, armedAt: null });
});

test("nothing fires while typing, while a modal is open, or when switched off, and it disarms", () => {
  for (const context of [{ ...ok, typing: true }, { ...ok, modalOpen: true }, { ...ok, enabled: false }]) {
    assert.deepEqual(interpretKey(press("g"), context, null, 1), { action: { type: "none" }, armedAt: null });
    assert.deepEqual(interpretKey(press("?"), context, null, 1), { action: { type: "none" }, armedAt: null });
    assert.deepEqual(interpretKey(press("n"), context, 1, 2), { action: { type: "none" }, armedAt: null });
  }
});

test("browser combinations are never taken: Cmd, Ctrl and Alt, even right after g", () => {
  for (const over of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
    assert.deepEqual(interpretKey(press("g", over), ok, null, 1), { action: { type: "none" }, armedAt: null });
    assert.deepEqual(interpretKey(press("n", over), ok, 1, 2), { action: { type: "none" }, armedAt: null });
  }
});

test("Shift with a letter is not a shortcut, and a held key or an IME composition is ignored", () => {
  assert.equal(interpretKey(press("G", { shiftKey: true }), ok, null, 1).action.type, "none");
  assert.equal(interpretKey(press("N", { shiftKey: true }), ok, 1, 2).action.type, "cancel");
  assert.deepEqual(interpretKey(press("g", { repeat: true }), ok, null, 1), { action: { type: "none" }, armedAt: null });
  assert.deepEqual(interpretKey(press("n", { repeat: true }), ok, 1, 2), { action: { type: "none" }, armedAt: 1 });
  assert.deepEqual(interpretKey(press("n", { isComposing: true }), ok, 1, 2), { action: { type: "none" }, armedAt: 1 });
});

test("pressing a modifier key alone between g and the next key keeps g armed, with its own flag set as a browser sets it", () => {
  const cases: [string, Partial<KeyInput>][] = [
    ["Shift", { shiftKey: true }], ["Control", { ctrlKey: true }], ["Alt", { altKey: true }],
    ["Meta", { metaKey: true }], ["CapsLock", {}],
  ];
  for (const [key, over] of cases) {
    assert.deepEqual(interpretKey(press(key, over), ok, 1000, 1100), { action: { type: "none" }, armedAt: 1000 }, key);
  }
});

test("a plain letter that is not g does nothing when nothing is armed", () => {
  assert.deepEqual(interpretKey(press("n"), ok, null, 1), { action: { type: "none" }, armedAt: null });
});
