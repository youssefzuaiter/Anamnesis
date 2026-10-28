# Keyboard shortcuts and a `?` cheat-sheet: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Go-to shortcuts (`g` then a letter), a `?` cheat-sheet and a switch to turn the single-key shortcuts off, beside the existing ⌘K and ⌘J, never firing while the person is typing.

**Architecture:** One pure module, `src/lib/shortcuts.ts`, holds the shortcut data and the key-handling rules (a small state machine that takes a key event plus context and returns an action). A client `ShortcutsProvider` mounted in the dashboard layout listens on `window`, applies the actions (navigate, show the hint, open the sheet), stores the on/off preference per browser like the theme, and renders a native `<dialog>` sheet and a hint pill. The sidebar footer gets a button that opens the sheet.

**Tech Stack:** Next.js 16 (`useRouter`), React 19 (`useSyncExternalStore`), Tailwind 4 tokens, `node:test`, Playwright. No new dependency, no schema change.

**Spec:** the design the user approved on 2026-10-28 ("yes build it"): https://claude.ai/artifact/8CyP1EsrjWspZEFYf3mEAy, and `ROADMAP.md` item 3. A small change, so there is no separate spec file; this plan carries the design.

## Global Constraints

- Free and local only; no new dependency; no schema or migration change; nothing is stored on the server (the preference lives in this browser's `localStorage`, key `anamnesis-shortcuts`, value `off` or `on`; anything else means on).
- The roadmap's rule: **never fire inside a text field.** Also never fire while ⌘, Ctrl or Alt is held, while an IME is composing, on a held-key repeat, or while a modal is open (`dialog[open]` or `[aria-modal="true"]`).
- Match on `event.key`, lower-cased, never `event.code`, so other keyboard layouts (Turkish, for one) work.
- ⌘K and ⌘J are not touched and are not affected by the switch. The switch is required by WCAG 2.1.4 (single-character shortcuts must be switchable off): when Off, `g` sequences and `?` do nothing, and the sidebar button still opens the sheet.
- The keys are exactly: `h` Today `/`, `n` Notes `/notes`, `s` Search `/search`, `t` Tasks `/tasks`, `c` Calendar `/calendar`, `p` Projects `/projects`, `g` Goals `/goals`, `u` Courses `/courses`, `d` Cards `/cards`, `r` Review `/review`, `f` Focus `/focus`, `a` Audit trail `/audit`, `x` Trash `/trash`, `,` Settings `/settings`, `i` Assistant `/ai`; each pressed after `g`, within 1,500 ms.
- The sheet is a native `<dialog>` (focus trapping, Escape and the backdrop come from the browser, as the phone's More sheet already does). Its close button and the switch are at least 44px tall; text no smaller than 12px; keycaps are `<kbd>`; the Off state is shown in words and dashed keycaps, not by colour alone.
- The sidebar button matches its neighbours (`min-h-9`): the sidebar is hidden on a phone, so there is no phone entry button; a hardware keyboard can press `?`.
- Quiet Studio tokens only. Commit messages end with the `Co-Authored-By` line the session's attribution reminder gives.

## Review Focus

Each line has its test in the task named.

1. A key typed in any text field, text area, select or contenteditable never navigates, and neither does a key typed after `g` has been pressed and focus then moved into a field. (Task 1 unit; Task 3 e2e)
2. ⌘, Ctrl and Alt combinations (⌘G is "find next" in browsers) never trigger a shortcut, and a held key (`repeat`) and an IME composition are ignored. (Task 2 unit)
3. `g`, a pause longer than 1,500 ms, then `n` does nothing. (Task 2 unit; Task 3 e2e)
4. With the switch Off: `g n` and `?` are inert, the choice survives a reload, ⌘K still opens the palette, and the sidebar button still opens the sheet. (Task 3 e2e)
5. While any modal is open (the palette, the phone More sheet, the cheat-sheet) nothing fires. (Task 2 unit; Task 3 e2e for the sheet)
6. Every destination in the sidebar has a key, with the same label, so adding a sidebar item without a key fails a test. (Task 1 unit)
7. At 375px the sheet opens with `?`, does not widen the page, and its close button and switch are at least 44px. (Task 3 e2e)

---

### Task 1: Shortcut data, the typing check and the preference rule

**Files:**
- Create: `src/lib/shortcuts.ts`
- Test: `tests/unit/shortcuts.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. The test imports `NAV_GROUPS` and `MOBILE_MORE` from `@/components/nav-items` (a pure module).
- Produces (exported from `src/lib/shortcuts.ts`):
  - `type GoToShortcut = { key: string; href: string; label: string }` and `const GO_TO_SHORTCUTS: readonly GoToShortcut[]` (the 15 above, in that order)
  - `type AnywhereShortcut = { label: string; keys: readonly string[] }` and `const ANYWHERE_SHORTCUTS: readonly AnywhereShortcut[]`: `Search and jump to anything` `["⌘","K"]`, `Ask the assistant` `["⌘","J"]`, `Show this list` `["?"]`, `Close a panel` `["Esc"]`
  - `const GO_TO_PREFIX = "g"`, `const SEQUENCE_TIMEOUT_MS = 1500`, `const SHORTCUTS_STORAGE_KEY = "anamnesis-shortcuts"`
  - `type TargetDescriptor = { tagName: string; type?: string; isContentEditable?: boolean; role?: string | null }`
  - `isTypingTarget(target: TargetDescriptor | null): boolean`
  - `parseShortcutsPreference(value: string | null | undefined): boolean` (true means on)

- [ ] **Step 1: Write the failing tests** in `tests/unit/shortcuts.test.ts` (`node:test`, `node:assert/strict`, imports from `@/lib/shortcuts` and `@/components/nav-items`):

```ts
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
```

- [ ] **Step 2: Run to confirm failure.** Run: `pnpm exec tsx --conditions=react-server --test tests/unit/shortcuts.test.ts` — Expected: FAIL, cannot find module `@/lib/shortcuts`.
- [ ] **Step 3: Implement the data, `isTypingTarget` and `parseShortcutsPreference`** in `src/lib/shortcuts.ts` (pure: no React, no DOM types). `isTypingTarget`: true for tag `TEXTAREA` or `SELECT`; for `INPUT` unless `type` is one of `button checkbox color file image radio range reset submit`; for `isContentEditable`; for `role` of `textbox combobox searchbox spinbutton`. Compare tag names upper-case.
- [ ] **Step 4: Run to confirm pass.** Same command — Expected: all pass. Then `pnpm test` — Expected: unit and render suites still pass.
- [ ] **Step 5: Commit** the plan, `src/lib/shortcuts.ts` and `tests/unit/shortcuts.test.ts` ("Add the keyboard shortcut data, the typing check and the preference rule").

---

### Task 2: The key-handling rules

**Files:**
- Modify: `src/lib/shortcuts.ts`
- Test: `tests/unit/shortcuts.test.ts`

**Interfaces:**
- Consumes: `GO_TO_SHORTCUTS`, `GO_TO_PREFIX`, `SEQUENCE_TIMEOUT_MS` from Task 1.
- Produces (exported from `src/lib/shortcuts.ts`):
  - `type KeyInput = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean; isComposing: boolean }`
  - `type ShortcutContext = { enabled: boolean; typing: boolean; modalOpen: boolean }`
  - `type ShortcutAction = { type: "none" } | { type: "arm" } | { type: "cancel" } | { type: "go"; href: string } | { type: "help" }`
  - `interpretKey(input: KeyInput, context: ShortcutContext, armedAt: number | null, now: number): { action: ShortcutAction; armedAt: number | null }`

Rules, in this order. (1) Not `enabled`, `typing`, or `modalOpen`: `none` and disarm (`armedAt` null). (2) `isComposing` or `repeat`: `none`, `armedAt` unchanged. (3) A modifier-only key (`Shift`, `Control`, `Alt`, `Meta`, `CapsLock`): `none`, `armedAt` unchanged. This must come before rule 4, because in a browser the keydown for pressing Control alone already has `ctrlKey` true (likewise Alt and Meta), and a stray modifier press must not cancel a pending `g`. (4) `ctrlKey`, `metaKey` or `altKey`: `none` and disarm. (5) Armed means `armedAt !== null` and `now - armedAt <= SEQUENCE_TIMEOUT_MS`. When armed: a key whose lower-case matches a go-to key, with `shiftKey` false, is `go` (that href) and disarms; `Escape` is `cancel`; `?` is `help`; anything else is `cancel`; all of these disarm. (6) Not armed (or expired): lower-case `g` with `shiftKey` false is `arm` with `armedAt` = `now`; `?` is `help`; anything else is `none`.

- [ ] **Step 1: Write the failing tests** (same file; helper `const press = (key, over = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, ...over })` and `const ok = { enabled: true, typing: false, modalOpen: false }`):

```ts
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
```

- [ ] **Step 2: Run to confirm failure** (`interpretKey` is not exported). Same command as Task 1 — Expected: FAIL.
- [ ] **Step 3: Implement `interpretKey`** per the rules above, reusing `GO_TO_SHORTCUTS`. The first rule that applies wins; keep it a single function with no module state.
- [ ] **Step 4: Run to confirm pass.** Task 1's command, then `pnpm test` — Expected: all pass. Then mutation-check three rules (drop the typing guard, drop the timeout comparison, drop the modifier guard): each must make a test fail; restore the file after each.
- [ ] **Step 5: Commit** ("Add the key-handling rules for the go-to shortcuts").

---

### Task 3: The provider, the sheet, the hint and the sidebar button

**Files:**
- Create: `src/components/shortcuts-provider.tsx`, `src/components/shortcuts-sheet.tsx`
- Modify: `src/components/icons.tsx` (add a `keyboard` icon), `src/components/app-sidebar.tsx`, `src/app/(dashboard)/layout.tsx`
- Test: `tests/e2e/shortcuts.spec.ts` (new; copy the 3-line `main(page)` helper from `workspace.spec.ts`)

**Interfaces:**
- Consumes: everything exported by Tasks 1 and 2; `useRouter` and `usePathname` from `next/navigation`.
- Produces:
  - `ShortcutsProvider({ children })` and `ShortcutsButton()` and `useShortcuts(): { openSheet: () => void }` in `src/components/shortcuts-provider.tsx` (`"use client"`). The provider keeps the on/off preference with `useSyncExternalStore` (same shape as `theme-switch.tsx`: a read function with try/catch defaulting to on, a same-tab change event, a `storage` listener, a server snapshot of on), registers one `window` `keydown` listener, builds the `KeyInput` and `ShortcutContext` for `interpretKey` (`typing` from `isTypingTarget` on a descriptor of `event.target`; `modalOpen` from `document.querySelector('dialog[open], [aria-modal="true"]')`; skips events already `defaultPrevented`), and acts: `go` calls `router.push(href)` unless `pathname` already equals it, and `preventDefault()`s; `help` opens the sheet and `preventDefault()`s; `arm` shows the hint and starts a 1,500 ms timer that hides it; `cancel` and a disarming `none` hide it. It renders `children`, the hint pill and `ShortcutsSheet`.
  - The hint pill: a `role="status"` element that is always mounted and visually hidden (`sr-only`) when not armed, so screen readers announce the change; when armed it is the bottom-left pill from the design (`g` keycap, `Go to…`, `n Notes`, `t Tasks`, `c Calendar`, `? All keys`, `Esc Cancel`).
  - `ShortcutsSheet(props: { ref: Ref<HTMLDialogElement>; enabled: boolean; onToggle: () => void })` in `src/components/shortcuts-sheet.tsx`: the native `<dialog>` from the design: heading `Keyboard shortcuts`, close button (`aria-label="Close"`, `min-h-11`), two sections `Anywhere` and `Go to` (two columns of the 15 rows on wide screens, one column on a phone, built from `ANYWHERE_SHORTCUTS` and `GO_TO_SHORTCUTS`), the line `On Windows and Linux, use Ctrl instead of ⌘.`, a `Press g, then a key.` line, when Off the note `Off: these keys do nothing until you turn single-key shortcuts back on.` and dashed keycaps, and a footer with `Single-key shortcuts`, the helper text `Go to keys and ? pause while you type in a field. ⌘K and ⌘J always work.` and a `role="switch"` button (`aria-checked`, labelled by `Single-key shortcuts`, `min-h-11`) with the word `On` or `Off` beside it. A click on the backdrop closes it, as in `mobile-nav.tsx`.

- [ ] **Step 1: Write the failing e2e tests** (`tests/e2e/shortcuts.spec.ts`; `hint = (page) => page.getByRole("status").filter({ hasText: "Go to…" })`, `sheet = (page) => page.getByRole("dialog", { name: "Keyboard shortcuts" })`, `single = (page) => sheet(page).getByRole("switch", { name: "Single-key shortcuts" })`):
  1. *g then a letter goes there, and the hint shows between them*: `goto("/")`; press `g`; `hint` visible; press `n`; `waitForURL("**/notes")`; `hint` hidden. Repeat for `t` to `/tasks` and `,` to `/settings`; `g` then `h` returns to `/`.
  2. *the hint goes away on its own and an old g is forgotten*: `goto("/")`; press `g`; `hint` visible; `waitForTimeout(1700)`; `hint` hidden; press `n`; still at `/` (`toHaveURL(/localhost:\d+\/$/)`).
  3. *typing never navigates*: `goto("/notes/new")`; click `Note title`; type `gn`; the field's value is `gn` and the URL is unchanged; likewise typing `?` in `Note content` leaves the sheet closed. Press `g` on the page, then click into `Note title` and type `n`: the value is `n` and there is no navigation.
  4. *? opens the cheat-sheet, Escape closes it, and so does the sidebar button path*: `goto("/")`; press `Shift+Slash`; `sheet` visible, listing `Notes` and `Audit trail` and the four always-on keys; press `Escape`; hidden. Click the sidebar button `Keyboard shortcuts`; visible; click `Close`; hidden. While it is open, pressing `g` then `n` does not navigate.
  5. *the switch turns the single-key shortcuts off, keeps that across a reload, and leaves ⌘K and the button alone*: open the sheet, click `single`: `aria-checked="false"`, the Off note visible. Close; press `g` then `n`: no navigation and no hint; press `Shift+Slash`: no sheet. `reload()`: still Off (open the sheet with the sidebar button and check `aria-checked`). Press `Control+k`: the command palette opens (`getByRole("dialog")` containing its search box). Switch back On: `g` `n` works again.
  6. *the command palette does not navigate on g then n*: `goto("/")`, press `Control+k`; the palette's search box is focused; press `g` then `n`: the URL is unchanged and the box holds `gn`. (Focus in its input means the typing rule applies here; the modal rule is covered by the unit test and by the sheet in test 4.)
  7. *on a phone the cheat-sheet fits and is easy to use*: `setViewportSize({ width: 375, height: 812 })`, `goto("/")`, press `Shift+Slash`: `sheet` visible; `documentElement.scrollWidth - clientWidth <= 0`; the `Close` button and the switch each have `boundingBox().height >= 44`.

- [ ] **Step 2: Run to confirm failure.** Run (background priority; reuses the dev server): `nice -n 19 pnpm exec playwright test tests/e2e/shortcuts.spec.ts` — Expected: the tests FAIL (no sheet, no navigation); the rest of the suite is untouched.
- [ ] **Step 3: Implement `ShortcutsSheet`** with Quiet Studio tokens (`bg-surface`, `border-border-strong`, `shadow-card`, `bg-surface-subtle` keycaps with `border-border-strong`, `text-text-muted`, the accent for the On switch track and `bg-control` for Off). Look at `mobile-nav.tsx` for the `<dialog>` and backdrop-click pattern, and add a `keyboard` icon to `icons.tsx` in the same single-path stroke style.
- [ ] **Step 4: Implement `ShortcutsProvider`, `ShortcutsButton` and `useShortcuts`** as described. Wrap the dashboard layout's children with the provider (inside `AssistantDockProvider`), and add `ShortcutsButton` to the sidebar footer under `ThemeSwitch`: a row `Keyboard shortcuts` with a `?` keycap on the right, styled like its `Export my data` neighbour.
- [ ] **Step 5: Run to confirm pass.** Step 2's command — Expected: the seven new tests pass. Then the whole suite, `nice -n 19 pnpm test:e2e` — Expected: every test passes, including the palette, assistant and note tests that type into fields.
- [ ] **Step 6: Commit** ("Add the go-to shortcuts, the cheat-sheet and the switch").

---

### Task 4: Guard, check, record, ship

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `ROADMAP.md`

- [ ] **Step 1: Guard.** Run the `security-review` skill over the diff: no new route, action or input reaches the server; the only stored value is a local `on`/`off`; `router.push` only receives hrefs from the static table. Ledger what it found.
- [ ] **Step 2: Simplify.** Run the `simplify` skill over `git diff <BASE>..HEAD -- src tests`; apply behaviour-preserving cleanups only.
- [ ] **Step 3: Check.** `nice -n 19` for each: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e`. Then look at it in the browser on a throwaway account (named with the `e2e` prefix, deleted afterwards): desktop and 375px, light and dark: the sheet, the Off state, the hint after `g`, and a real `g` then `n`.
- [ ] **Step 4: Review.** Read `code-reviewer.md` and review the whole branch yourself (no subagent tool); ledger `Final review: self-review (no subagent tool)`; Critical and Important findings get a failing test first; Minor go to the ledger.
- [ ] **Step 5: Record.** `CLAUDE.md`: a "Keyboard shortcuts" section (the pure rules module and why; the typing rule and the other guards; `event.key` not `event.code` and why; the WCAG 2.1.4 switch, stored per browser and not on the server; the one provider and the native dialog; the key map and why a few letters are compromises; what was not done: remapping, key hints in the sidebar, create shortcuts such as `c` for a new note, a phone entry button). `README.md`: add a bullet for the shortcuts. `ROADMAP.md`: tick item 3.
- [ ] **Step 6: Ship.** Commit, push `keyboard-shortcuts`, open a pull request against `main` (never a push to `main`) whose description lists what was verified and what was only read; report the checks once; do not poll CI.
