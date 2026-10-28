/**
 * The keyboard shortcuts beyond ⌘K and ⌘J, and the rules for when they fire.
 *
 * Pure on purpose, like `lib/theme.ts`: no React and no DOM types, so the
 * rules can be unit-tested and the provider (components/shortcuts-provider.tsx)
 * only wires them to the page.
 */

export type GoToShortcut = { key: string; href: string; label: string };

/**
 * Pressed after `g`. A key is the first letter of its destination where that is
 * free; `u` (Courses), `d` (Cards, a deck), `x` (Trash), `h` (Today, home) and
 * `i` (Assistant) are compromises. The labels equal the sidebar's, which a unit
 * test checks, so a new sidebar item cannot be added without a key.
 */
export const GO_TO_SHORTCUTS: readonly GoToShortcut[] = [
  { key: "h", href: "/", label: "Today" },
  { key: "n", href: "/notes", label: "Notes" },
  { key: "s", href: "/search", label: "Search" },
  { key: "t", href: "/tasks", label: "Tasks" },
  { key: "c", href: "/calendar", label: "Calendar" },
  { key: "p", href: "/projects", label: "Projects" },
  { key: "g", href: "/goals", label: "Goals" },
  { key: "u", href: "/courses", label: "Courses" },
  { key: "d", href: "/cards", label: "Cards" },
  { key: "r", href: "/review", label: "Review" },
  { key: "f", href: "/focus", label: "Focus" },
  { key: "a", href: "/audit", label: "Audit trail" },
  { key: "x", href: "/trash", label: "Trash" },
  { key: ",", href: "/settings", label: "Settings" },
  { key: "i", href: "/ai", label: "Assistant" },
];

export type AnywhereShortcut = { label: string; keys: readonly string[] };

/** Shown in the cheat-sheet. ⌘K and ⌘J are handled by their own components. */
export const ANYWHERE_SHORTCUTS: readonly AnywhereShortcut[] = [
  { label: "Search and jump to anything", keys: ["⌘", "K"] },
  { label: "Ask the assistant", keys: ["⌘", "J"] },
  { label: "Show this list", keys: ["?"] },
  { label: "Close a panel", keys: ["Esc"] },
];

export const GO_TO_PREFIX = "g";

/** How long a pressed `g` waits for the next key. */
export const SEQUENCE_TIMEOUT_MS = 1500;

export const SHORTCUTS_STORAGE_KEY = "anamnesis-shortcuts";

/**
 * Whether the single-key shortcuts are on. They are, unless the reader turned
 * them off here: a missing or corrupt stored value must never leave someone
 * without them by accident. (They have to be switchable off at all because
 * shortcuts made of one character can fire by accident for people who use
 * speech input or an assistive keyboard: WCAG 2.1.4.)
 */
export function parseShortcutsPreference(value: string | null | undefined): boolean {
  return value !== "off";
}

/** Just what `isTypingTarget` needs from a DOM element, so tests need no DOM. */
export type TargetDescriptor = {
  tagName: string;
  /** An `<input>`'s `type`. */
  type?: string;
  isContentEditable?: boolean;
  role?: string | null;
};

// Inputs that take no typed text, where a letter key should still be a shortcut.
const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const TEXT_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton"]);

/**
 * Is the key being pressed going into something that takes typing? A `<select>`
 * counts, since letters jump to an option in it.
 */
export function isTypingTarget(target: TargetDescriptor | null): boolean {
  if (!target) return false;
  const tag = target.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((target.type ?? "text").toLowerCase());
  if (target.isContentEditable) return true;
  return target.role != null && TEXT_ROLES.has(target.role);
}

/** The parts of a `KeyboardEvent` the rules look at. */
export type KeyInput = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
};

export type ShortcutContext = {
  /** The reader's on/off switch. */
  enabled: boolean;
  /** Focus is in something that takes typing. */
  typing: boolean;
  /** A modal (the palette, a sheet) is open. */
  modalOpen: boolean;
};

export type ShortcutAction =
  | { type: "none" }
  | { type: "arm" }
  | { type: "cancel" }
  | { type: "go"; href: string }
  | { type: "help" };

const NONE: ShortcutAction = { type: "none" };
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

/**
 * What one key press means, given whether `g` is waiting (`armedAt`, the time it
 * was pressed) and the time now. The first rule that applies wins:
 *
 * 1. Off, typing, or a modal open: nothing, and any waiting `g` is dropped.
 * 2. An IME composition or a held key: ignored, `g` keeps waiting.
 * 3. A modifier key pressed alone: ignored, `g` keeps waiting. This has to come
 *    before rule 4, because a browser's keydown for Control alone already has
 *    `ctrlKey` set, and a stray modifier must not cancel a waiting `g`.
 * 4. Ctrl, Cmd or Alt held: browser and OS shortcuts (Cmd+G is "find next")
 *    are never taken, and a waiting `g` is dropped.
 * 5. `g` waiting (within the timeout): a go-to key goes, `?` shows the list,
 *    anything else cancels.
 * 6. Otherwise `g` starts waiting and `?` shows the list.
 *
 * Keys are matched on `event.key`, lower-cased, so other keyboard layouts work.
 */
export function interpretKey(
  input: KeyInput,
  context: ShortcutContext,
  armedAt: number | null,
  now: number,
): { action: ShortcutAction; armedAt: number | null } {
  if (!context.enabled || context.typing || context.modalOpen) {
    return { action: NONE, armedAt: null };
  }
  if (input.isComposing || input.repeat) return { action: NONE, armedAt };
  if (MODIFIER_KEYS.has(input.key)) return { action: NONE, armedAt };
  if (input.ctrlKey || input.metaKey || input.altKey) {
    return { action: NONE, armedAt: null };
  }

  const key = input.key.toLowerCase();
  const waiting = armedAt !== null && now - armedAt <= SEQUENCE_TIMEOUT_MS;

  if (input.key === "?") return { action: { type: "help" }, armedAt: null };

  if (waiting) {
    const target = input.shiftKey
      ? undefined
      : GO_TO_SHORTCUTS.find((shortcut) => shortcut.key === key);
    if (target) return { action: { type: "go", href: target.href }, armedAt: null };
    return { action: { type: "cancel" }, armedAt: null };
  }

  if (key === GO_TO_PREFIX && !input.shiftKey) {
    return { action: { type: "arm" }, armedAt: now };
  }
  return { action: NONE, armedAt: null };
}
