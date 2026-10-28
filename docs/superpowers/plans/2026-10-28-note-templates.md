# Note templates: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "New note" offers five starting points (Blank, Lecture, Cornell, Paper summary, Meeting); choosing one writes a Markdown outline into the note without ever overwriting what the person typed.

**Architecture:** Templates are data in one pure module, `src/lib/note-templates.ts`, together with the two pure decision functions (when to ask before replacing, which fields to fill). A presentational `TemplatePicker` renders the chips and the replace question; `NoteEditor` owns the state and applies the values. `/notes/new?template=<id>` preselects and prefills on the server through the same module. No schema change.

**Tech Stack:** Next.js 16 (async `searchParams`), React 19, Tailwind 4 tokens, `node:test`, Playwright. No new dependency.

**Spec:** the description and clickable design the user approved on 2026-10-28 ("yes build it"): https://claude.ai/artifact/3WmTekb39dXKpTFGPCBURP, and `ROADMAP.md` item 2. A small change, so there is no separate spec file; this plan carries the design.

## Global Constraints

- Free and local only; no new dependency; no schema change or migration.
- Blank stays the default, and the existing blank-note flow (fill `Note title`, fill `Note content`, press `Create note`) behaves exactly as before. The inputs keep their `name`s (`title`, `content`, `tags`) and their labels (`Note title`, `Note content`, `Tags`): the Playwright suite selects by label.
- Only the create form gets the picker. Editing an existing note (the same `NoteEditor`) is unchanged.
- Adding a template is one array entry in `NOTE_TEMPLATES`; the unit tests enumerate the array, so a new entry is checked without editing a test.
- Never overwrite what the person typed: content is replaced only after a question when it was changed; title and tags are replaced only when empty or still the previous template's own value.
- The replace question is an inline group, not `window.confirm`; its buttons are outlined, so the page's one accent button stays `Create note`.
- Quiet Studio tokens only (`bg-accent-soft`, `border-control`, `text-accent-ink`, `shadow-card`, ...); every chip and button at least 44px tall (`min-h-11`); text no smaller than 12px; a selected chip is marked by a check icon, weight and `aria-pressed`, not by colour alone.
- Next 16: `searchParams` is a `Promise`; a value may be a string, an array or undefined.
- Date label is `Wed 28 Oct` (short weekday, day, short month, en-GB order), built from `Intl.DateTimeFormat("en-GB").formatToParts`, never from a string split.
- Commit messages end with the `Co-Authored-By` line the session's attribution reminder gives.

## Review Focus

Each line has its test in the task named.

1. `?template=` that is unknown, repeated (an array) or thousands of characters long falls back to Blank and never throws. (Task 1 unit for `getTemplate`; Task 3 e2e)
2. The replace question is already open for one template and another chip is pressed: the question names the new one; pressing the already-selected chip dismisses it. (Task 3)
3. Switching from an untouched template back to Blank applies without a question and clears the content, title and tags. (Task 2 unit; Task 3 e2e)
4. A title built from yesterday's date no longer equals today's rendering, so it is kept as if typed. That fails on the safe side: nothing is lost. (Task 2)
5. A template can be created: title is never empty after a non-blank pick, stays within the 200-character cap, and the body within the 100,000-character cap; the created note shows the outline in its reading view. (Task 1 unit; Task 3 e2e)
6. At 375px the page does not widen and every chip is at least 44px tall. (Task 3)

---

### Task 1: Template data, lookup and rendering

**Files:**
- Create: `src/lib/note-templates.ts`
- Test: `tests/unit/note-templates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exported from `src/lib/note-templates.ts`):
  - `type NoteTemplate = { id: string; name: string; description: string; title: string; tags: readonly string[]; body: string }` (`title` may contain the token `{date}`)
  - `type TemplateFields = { title: string; content: string; tags: string }`
  - `const BLANK_TEMPLATE_ID = "blank"`
  - `const NOTE_TEMPLATES: readonly NoteTemplate[]` (Blank first, then Lecture, Cornell, Paper summary, Meeting)
  - `getTemplate(id: string | null | undefined): NoteTemplate` (exact match; anything else is Blank)
  - `dateLabel(now: Date): string`
  - `renderTemplate(template: NoteTemplate, now: Date): TemplateFields` (`tags` joined with `", "`)

- [ ] **Step 1: Write the failing tests** in `tests/unit/note-templates.test.ts` (import from `@/lib/note-templates`, `node:test`, `node:assert/strict`, like `tests/unit/theme.test.ts`):

```ts
const NOW = new Date(2026, 9, 28, 12); // Wed 28 Oct 2026, local time

test("the templates are Blank first, then the four named in the roadmap", () => {
  assert.deepEqual(NOTE_TEMPLATES.map((t) => t.id), ["blank", "lecture", "cornell", "paper", "meeting"]);
  assert.deepEqual(NOTE_TEMPLATES.map((t) => t.name), ["Blank", "Lecture", "Cornell", "Paper summary", "Meeting"]);
});

test("every template is well formed and fits what a note may hold", () => {
  assert.equal(new Set(NOTE_TEMPLATES.map((t) => t.id)).size, NOTE_TEMPLATES.length);
  for (const t of NOTE_TEMPLATES) {
    assert.ok(t.name && t.description, t.id);
    const r = renderTemplate(t, NOW);
    assert.ok(!r.title.includes("{date}") && !r.title.includes("{"), t.id);
    assert.ok(r.title.length <= 200 && r.content.length <= 100_000, t.id);
    for (const tag of t.tags) assert.match(tag, /^[a-z0-9-]+$/, t.id); // lowercase, no commas or spaces
  }
});

test("Blank is empty; every other template has a title, a body that starts with a heading and ends with a newline, and a tag", () => {
  const blank = renderTemplate(getTemplate("blank"), NOW);
  assert.deepEqual(blank, { title: "", content: "", tags: "" });
  for (const t of NOTE_TEMPLATES.slice(1)) {
    const r = renderTemplate(t, NOW);
    assert.ok(r.title.length > 0 && r.tags.length > 0, t.id);
    assert.ok(r.content.startsWith("## ") && r.content.endsWith("\n"), t.id);
  }
});

test("the date label is short weekday, day, short month", () => {
  assert.equal(dateLabel(NOW), "Wed 28 Oct");
  assert.equal(dateLabel(new Date(2026, 0, 5, 9)), "Mon 5 Jan");
});

test("titles carry the date where the roadmap's templates name a day", () => {
  assert.equal(renderTemplate(getTemplate("lecture"), NOW).title, "Lecture, Wed 28 Oct");
  assert.equal(renderTemplate(getTemplate("cornell"), NOW).title, "Cornell notes, Wed 28 Oct");
  assert.equal(renderTemplate(getTemplate("meeting"), NOW).title, "Meeting, Wed 28 Oct");
  assert.equal(renderTemplate(getTemplate("paper"), NOW).title, "Paper summary");
});

test("the Cornell outline is the one in the design", () => {
  assert.equal(
    renderTemplate(getTemplate("cornell"), NOW).content,
    "## Cues and questions\n- \n\n## Notes\n- \n\n## Summary\nWrite two or three sentences after the lecture, without looking at the notes above.\n",
  );
});

test("an unknown, missing or hostile id is Blank, never a throw", () => {
  for (const id of [undefined, null, "", "nope", "LECTURE", "__proto__", "constructor", "a".repeat(5000)]) {
    assert.equal(getTemplate(id).id, "blank");
  }
  assert.equal(getTemplate("lecture").id, "lecture");
});
```

(Only Cornell's body is pinned verbatim, as a guard that the outline in the approved design was copied exactly; the other bodies are checked by shape in the third test.)

- [ ] **Step 2: Run to confirm failure.** Run: `pnpm exec tsx --conditions=react-server --test tests/unit/note-templates.test.ts` — Expected: FAIL, cannot find module `@/lib/note-templates`.

- [ ] **Step 3: Implement the module.** Pure, no React, no Prisma, no `server-only`. Bodies (join lines with `\n`, end with a trailing `\n`):
  - Lecture: `## Topic and course`, ``, `## Key ideas`, `- `, ``, `## Definitions and formulas`, `- `, ``, `## Examples from class`, `- `, ``, `## Questions to look up`, `- [ ] `, ``, `## Summary in my own words`, ``.
  - Cornell: `## Cues and questions`, `- `, ``, `## Notes`, `- `, ``, `## Summary`, `Write two or three sentences after the lecture, without looking at the notes above.`, ``.
  - Paper summary: `## Reference`, `Authors, year, venue.`, ``, `## Problem`, ``, `## Method`, ``, `## Results`, ``, `## Limits and open questions`, ``, `## Why it matters to me`, ``.
  - Meeting: `## Attendees`, `- `, ``, `## Agenda`, `- `, ``, `## Decisions`, `- `, ``, `## Action items`, `- [ ] `, ``.
  - Titles: `Lecture, {date}`, `Cornell notes, {date}`, `Paper summary`, `Meeting, {date}`; tags `lecture`, `cornell`, `paper`, `meeting`; descriptions as in the design (Blank: `An empty note.`; Lecture: `Topic, key ideas, definitions, worked examples, questions to look up and a summary.`; Cornell: `Cues on top, notes below, and a summary you write afterwards.`; Paper summary: `Reference, problem, method, results, limits, and why it matters to you.`; Meeting: `Attendees, agenda, decisions and action items as tasks to tick.`). `getTemplate` uses `Array.prototype.find` on `id`, so `__proto__` cannot match. `dateLabel` uses one module-level `Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" })` and joins its parts in the order weekday, day, month.

- [ ] **Step 4: Run to confirm pass.** Same command — Expected: all pass. Then `pnpm test` — Expected: unit and render suites still pass.

- [ ] **Step 5: Commit** `src/lib/note-templates.ts` and `tests/unit/note-templates.test.ts` ("Add the note template data, lookup and rendering").

---

### Task 2: When to ask, what to fill

**Files:**
- Modify: `src/lib/note-templates.ts`
- Test: `tests/unit/note-templates.test.ts`

**Interfaces:**
- Consumes: `getTemplate`, `renderTemplate`, `TemplateFields` from Task 1.
- Produces (exported from `src/lib/note-templates.ts`):
  - `type CurrentNote = TemplateFields & { templateId: string }`
  - `type TemplateChange = { action: "none" } | { action: "confirm" } | { action: "apply"; values: TemplateFields }`
  - `planTemplateChange(input: { current: CurrentNote; targetId: string; now: Date }): TemplateChange`
  - `applyTemplate(current: CurrentNote, targetId: string, now: Date): TemplateFields`

Rules: `none` when the target resolves to the template already selected. Otherwise the content is *changed* when `current.content.trim()` differs from the selected template's `body.trim()`; changed means `confirm`, unchanged means `apply`. `applyTemplate` returns the target's rendered content always; its title is the target's rendered title when the current title is empty, or equals (after trimming both) the selected template's rendered title, else the current title is kept; tags follow the same rule against the selected template's rendered tags.

- [ ] **Step 1: Write the failing tests** (same file; helper `const cur = (templateId, over = {}) => ({ templateId, ...renderTemplate(getTemplate(templateId), NOW), ...over })`):

```ts
test("choosing the template that is already selected does nothing", () => {
  assert.deepEqual(planTemplateChange({ current: cur("lecture"), targetId: "lecture", now: NOW }), { action: "none" });
  assert.deepEqual(planTemplateChange({ current: cur("blank"), targetId: "nope", now: NOW }), { action: "none" }); // unknown is Blank
});

test("from Blank with nothing typed, a template applies without a question", () => {
  const r = planTemplateChange({ current: cur("blank"), targetId: "lecture", now: NOW });
  assert.equal(r.action, "apply");
  if (r.action === "apply") assert.deepEqual(r.values, renderTemplate(getTemplate("lecture"), NOW));
});

test("switching between untouched templates replaces content, title and tags with no question", () => {
  const r = planTemplateChange({ current: cur("lecture"), targetId: "meeting", now: NOW });
  assert.equal(r.action, "apply");
  if (r.action === "apply") assert.deepEqual(r.values, renderTemplate(getTemplate("meeting"), NOW));
});

test("going back to Blank from an untouched template clears everything with no question", () => {
  const r = planTemplateChange({ current: cur("cornell"), targetId: "blank", now: NOW });
  assert.deepEqual(r, { action: "apply", values: { title: "", content: "", tags: "" } });
});

test("changed content asks first, for a template and for Blank", () => {
  assert.equal(planTemplateChange({ current: cur("lecture", { content: "my own words" }), targetId: "cornell", now: NOW }).action, "confirm");
  assert.equal(planTemplateChange({ current: cur("blank", { content: "typed" }), targetId: "lecture", now: NOW }).action, "confirm");
  assert.equal(planTemplateChange({ current: cur("lecture", { content: "typed" }), targetId: "blank", now: NOW }).action, "confirm");
});

test("a whitespace-only difference is not a change", () => {
  const lecture = renderTemplate(getTemplate("lecture"), NOW);
  assert.equal(planTemplateChange({ current: cur("lecture", { content: lecture.content + "\n\n" }), targetId: "meeting", now: NOW }).action, "apply");
  assert.equal(planTemplateChange({ current: cur("blank", { content: "  \n" }), targetId: "lecture", now: NOW }).action, "apply");
});

test("a title or tags the person typed are kept; empty ones are filled", () => {
  const kept = applyTemplate(cur("lecture", { title: "Ada's seminar", tags: "ml, week3" }), "meeting", NOW);
  assert.equal(kept.title, "Ada's seminar");
  assert.equal(kept.tags, "ml, week3");
  assert.equal(kept.content, renderTemplate(getTemplate("meeting"), NOW).content);
  const filled = applyTemplate(cur("blank", { title: "  ", tags: "" }), "meeting", NOW);
  assert.equal(filled.title, "Meeting, Wed 28 Oct");
  assert.equal(filled.tags, "meeting");
});

test("a title still equal to the previous template's, even with stray spaces, counts as not typed", () => {
  assert.equal(applyTemplate(cur("lecture", { title: " Lecture, Wed 28 Oct " }), "cornell", NOW).title, "Cornell notes, Wed 28 Oct");
});

test("yesterday's auto title is kept as if typed: nothing is lost", () => {
  const yesterday = cur("lecture", { title: "Lecture, Tue 27 Oct" });
  assert.equal(applyTemplate(yesterday, "meeting", NOW).title, "Lecture, Tue 27 Oct");
});
```

- [ ] **Step 2: Run to confirm failure** (`planTemplateChange` is not exported). Same command as Task 1 — Expected: FAIL.
- [ ] **Step 3: Implement `planTemplateChange` and `applyTemplate`** per the rules above, reusing `getTemplate` and `renderTemplate` (do not re-derive the selected template's body or title by hand).
- [ ] **Step 4: Run to confirm pass.** Task 1's command, then `pnpm test` — Expected: all pass.
- [ ] **Step 5: Commit** ("Add the rules for when a template asks before replacing, and what it fills").

---

### Task 3: The picker, the editor and the deep link

**Files:**
- Create: `src/components/template-picker.tsx`
- Modify: `src/components/note-editor.tsx`, `src/app/(dashboard)/notes/new/page.tsx`
- Test: `tests/e2e/workspace.spec.ts` (append; it already has `main(page)` and `createNote`)

**Interfaces:**
- Consumes: `NOTE_TEMPLATES`, `NoteTemplate`, `getTemplate`, `renderTemplate`, `planTemplateChange`, `applyTemplate` (Tasks 1 and 2).
- Produces:
  - `TemplatePicker(props: { templates: readonly NoteTemplate[]; selectedId: string; pendingName: string | null; onPick: (id: string) => void; onReplace: () => void; onKeep: () => void })` in `src/components/template-picker.tsx`. Renders a `Start from` label (12px, semibold, `text-text-muted`), a `role="group"` of chip `<button type="button">`s with `aria-pressed`, the selected template's description, and, when `pendingName` is not null, a `role="group"` titled `Replace what you have written?` with the text `Choosing {pendingName} swaps the text below for its outline. Your own title and tags are kept.` and two buttons, `Replace text` and `Keep my text` (the latter has `autoFocus`).
  - `NoteEditor` gains an optional prop `templatePicker?: { initialTemplateId: string }`; the picker renders only when it is given.

**Decision (ruling, with reason):** `NoteEditor` moves `title`, `content` and `tags` from `defaultValue` to controlled state (`useState` seeded from `initial`). The inputs keep their `name`s, so the form posts exactly as before. Reason: a template pick has to write into the fields, and React 19 resets uncontrolled form fields to their `defaultValue` when a form action finishes, which would drop what a pick wrote if a submit returned an error; controlled values do not depend on that reset. This also changes the edit form, which shares the component, so the existing edit and version tests are the regression check.

- [ ] **Step 1: Write the failing e2e tests** (append to `tests/e2e/workspace.spec.ts`; `chip = (page, name) => main(page).getByRole("button", { name, exact: true })`, `title = main(page).getByLabel("Note title")`, `content = main(page).getByLabel("Note content")`, `tags = main(page).getByLabel("Tags")`, `question = main(page).getByText("Replace what you have written?")`):
  1. *a template fills the note and the created note shows its outline*: `goto("/notes/new")`; click `Cornell`; expect `chip Cornell` `aria-pressed="true"`, `title` value `/^Cornell notes, /`, `content` value containing `## Cues and questions`, `tags` value `cornell`; click `Create note` (by label, in `main`); `waitForURL(/\/notes\/[0-9a-f-]{36}$/)`; expect `main` heading `Cues and questions` visible (`##` renders as an h3).
  2. *an untouched switch asks nothing; typed text asks first, Keep keeps and Replace replaces*: click `Lecture`, then `Meeting`: `question` not visible and `content` contains `## Attendees`. Fill `content` with `my own words`; click `Paper summary`: `question` visible and mentions `Paper summary`; `Keep my text` is focused; click it: `content` is `my own words`, `Meeting` still pressed, `content` focused. Click `Paper summary` again, then `Replace text`: `content` contains `## Reference`, `question` gone, `Paper summary` pressed.
  3. *pressing another chip while the question is open updates it; pressing the selected chip dismisses it*: fill `content` `x`; click `Lecture` (question names Lecture); click `Meeting` (question names Meeting); click `Blank` (the selected one): `question` gone and `content` is still `x`.
  4. *back to Blank clears an untouched template*: click `Lecture`, then `Blank`: `title`, `content`, `tags` all empty, `question` not visible.
  5. *the link preselects, and a bad template id is Blank*: `goto("/notes/new?template=meeting")`: `Meeting` pressed and `content` contains `## Attendees`. For `?template=nope`, `?template=lecture&template=cornell` and `?template=` + 5,000 `a`s: `Blank` pressed and `content` empty. `goto("/notes/new?title=Ada&template=lecture")`: `title` is `Ada` and `content` contains `## Key ideas`.
  6. *at 375px the page does not widen and every chip is at least 44px tall*: `setViewportSize({ width: 375, height: 812 })`, `goto("/notes/new")`; `documentElement.scrollWidth - clientWidth <= 0`; each chip's `boundingBox().height >= 44`.
  7. *editing an existing note shows no picker*: `createNote(page, "Plain " + Date.now(), "x")`, click `Edit`: `Start from` not visible.

- [ ] **Step 2: Run to confirm failure.** Run (background priority, the dev server is reused): `nice -n 19 pnpm exec playwright test -g "template|Blank|Start from"` — Expected: the new tests FAIL (no chips on the page); every older test still passes.
- [ ] **Step 3: Implement `TemplatePicker`** with Quiet Studio tokens: selected chip `border-accent bg-accent-soft text-accent-ink` with a filled-check icon, unselected `border-control bg-surface text-text hover:bg-surface-subtle` with a ring icon (same width, so selecting does not shift the row), both `min-h-11 rounded-lg border-[1.5px] px-4 text-sm font-semibold`; look in `src/components/icons.tsx` for a check icon before drawing one. The question group: `rounded-xl border border-border-strong bg-surface p-4 shadow-card`, both buttons outlined (`min-h-11`), the first `border-text`, the second `border-control text-text-muted`.
- [ ] **Step 4: Implement the editor changes.** Controlled `title`/`content`/`tags`; `selectedId` (from `templatePicker.initialTemplateId`) and `pendingId` state; a ref on the content textarea. `onPick(id)` calls `planTemplateChange` with `now: new Date()` and the current state: `none` sets `pendingId` to null; `confirm` sets `pendingId`; `apply` sets the three fields, `selectedId`, clears `pendingId`. `onReplace` calls `applyTemplate` for `pendingId`, sets fields and `selectedId`, clears `pendingId`, then focuses the textarea; `onKeep` clears `pendingId` and focuses the textarea. Render `TemplatePicker` above the title input, only when `templatePicker` is given, with `pendingName` from `getTemplate(pendingId).name`.
- [ ] **Step 5: Implement the page.** In `src/app/(dashboard)/notes/new/page.tsx`: `const templateId = typeof params.template === "string" ? params.template : undefined; const template = getTemplate(templateId); const rendered = renderTemplate(template, new Date());` `initial.title = presetTitle || rendered.title`, `initial.content = rendered.content`, `initial.tags = [...template.tags]`; pass `templatePicker={{ initialTemplateId: template.id }}` to `NoteEditor`. Leave the rest of the page, including `FocusTracker`, as it is.
- [ ] **Step 6: Run to confirm pass.** Step 2's command — Expected: the seven new tests pass. Then the whole suite, `nice -n 19 pnpm test:e2e` — Expected: every test passes, including the edit, version and bulk tests that use the same editor.
- [ ] **Step 7: Commit** ("Add the template picker to New note").

---

### Task 4: Guard, check, record, ship

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `ROADMAP.md`

- [ ] **Step 1: Guard.** Run the `security-review` skill over the diff: the only new input is the `template` query parameter, and it is used only to look up a static table; its text then goes through the existing `noteSchema` (title 200, content 100,000). Ledger what it found.
- [ ] **Step 2: Simplify.** Run the `simplify` skill over `git diff <BASE>..HEAD -- src tests`; apply behaviour-preserving cleanups only.
- [ ] **Step 3: Check.** `nice -n 19` for each: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e`. Then look at `/notes/new` in the browser on a throwaway account (named with the `e2e` prefix, deleted afterwards): desktop and 375px, light and dark, blank, Lecture chosen, and the replace question; compare with the approved design.
- [ ] **Step 4: Review.** Read `code-reviewer.md` and review the whole branch yourself (no subagent tool); ledger `Final review: self-review (no subagent tool)`; Critical and Important findings get a failing test first, Minor go to the ledger.
- [ ] **Step 5: Record.** `CLAUDE.md`: a "Note templates" section (the data module and why, the controlled-editor ruling and its reason, the replace rule and the title/tags rule, the date label and why picks use the browser's date while the link uses the server's, the deep link and that an unknown id is Blank, and what was not done: user-made templates, command-palette entries, templates on edit, per-course templates). `README.md`: add templates to the Notes bullet. `ROADMAP.md`: tick item 2.
- [ ] **Step 6: Ship.** Commit, push `note-templates`, open a pull request against `main` (never a push to `main`) whose description lists what was verified and what was only read; report the checks once; do not poll CI.
