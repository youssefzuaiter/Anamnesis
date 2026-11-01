# Cloze cards, per-course decks and cards from selected text: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cards can be fill-in-the-blank, can be made by hand or from text selected in a note, and the review queue can be limited to one course's deck (ROADMAP item 9).

**Architecture:** A pure `lib/cloze.ts` parses Anki-style `{{c1::answer::hint}}` text and renders a card's front and back. One additive nullable column (`Flashcard.clozeIndex`) marks a cloze card; a deck is the course of the card's note, derived at read time, so there is no `courseId` on a card. One native-`<dialog>` editor (`CardMaker`) serves both the "New card" button and the floating tray that appears while text in the note body is selected.

**Tech Stack:** Next.js 16 (server actions, `searchParams` is a Promise), React 19, Prisma 7 + Postgres, Zod, node:test, Playwright. No new dependencies.

**Spec:** none written. The design is in this plan; it was not shown as a mock because ROADMAP item 9 is not tagged *demo*. The decisions below were made after a council run inline by me, not by independent subagents, so it is weaker than four separate voices. `CLAUDE.md` (sections "Building features, one at a time", "Testing UI with Playwright", "Operations") and `AGENTS.md` bind.

## Global Constraints

- No new dependency. The cloze grammar is three constructs and is written by hand. (`search-first` could not be run: the network was unreachable while planning.)
- The only schema change is `ALTER TABLE "Flashcard" ADD COLUMN "clozeIndex" INTEGER;` (nullable, so the previous release keeps working: "add freely, never drop or rename").
- Every query is scoped by the session's `userId` (`requireUserId()`); every client-supplied id (`noteId`, the `course` parameter) is only ever used inside a `userId`-scoped query.
- Cards are plain text. React renders pieces as text nodes, never HTML. `$...$` stays literal in a card.
- Next 16: `searchParams` is a `Promise`. Read `node_modules/next/dist/docs/` for anything new in routing before writing it.
- Quiet Studio tokens only (`src/app/globals.css`): one accent button per screen (`bg-accent text-on-accent hover:bg-accent-hover`), outlined secondary buttons (`border border-border-strong`), form borders `border-control`, targets at least 44px (`min-h-11`), no text under 12px.
- Playwright: select by label/role and assert on `page.locator("main")`, never `body`; workers 1; run at normal priority (the suite is flaky at `nice 19` next to Ollama on this machine).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `git add -A`: `next dev` rewrites `AGENTS.md`, which must not be committed.

## Decisions (for CLAUDE.md, with the cost accepted)

1. **A deck is a course, derived from the card's note.** A stored `Flashcard.courseId` was rejected: it supports note-less cards but goes stale when a note changes course unless every note write path (bulk assign included) also updates cards. A card with no note, a note with no course, or a note whose course is soft-deleted is in the **No course** deck. *Cost:* a card cannot exist without a note; a deck follows its notes when they move.
2. **A cloze text makes one row per distinct number**, each holding the whole source text in `question`, the group's answers joined `", "` in `answer`, and the number in `clozeIndex` (null = basic). `answer` duplicates what the text says; it cannot drift because cards cannot be edited, and it keeps the row readable and usable by item 10 ("Quiz me"). *Cost:* a text's cards are siblings only by sharing `noteId` and `question`.
3. **Siblings are held back.** The front of one sibling shows another's answer, so a session shows the first of each group; the rest stay due for the next session.
4. **A trashed note's cards are not due.** One rule (`liveCards`) feeds the nav badge, Today, the deck counts and the queue. They return on restore. This changes `countDue`/`listDue`/`countCards`, which used to count them while `countDueForCourse` did not.
5. **One editor for by-hand and from-selection.** The server never sees or verifies the selection, only the final text the person submits and a note id that must be theirs.

## Review Focus

Most likely first. Each has a test in the task that owns the code.

1. Hostile cloze text of 100,000 characters (repeated openers, one closer at the end, nested openers, a huge hint) parses in well under a second (T1).
2. A foreign, trashed or missing `noteId` is one refusal and writes nothing; a foreign course id in `?course=` shows an empty deck and reveals nothing (T2, T4).
3. A malformed or unclosed marker is refused with a message, never stored as a half card; braces inside text selected from a note are neutralised in the prefill (T1, T3).
4. Cards of a trashed note leave the nav badge, Today, deck counts and the queue together, and return on restore (T2, T4).
5. Two numbers from one text give two rows but one card per session (T1, T4).
6. A double click on Add makes one set of cards, not two (T3).
7. A selection that reaches outside the note body (title, side rail) shows no tray (T3).
8. A formula inside a selection appears once, as `$...$`, not twice (T3).
9. At 375px the tray, dialog and deck nav fit with no horizontal overflow and 44px targets, in light and dark (T3, T4).

---

### Task 1: The cloze rules (`lib/cloze.ts`)

**Files:**
- Create: `src/lib/cloze.ts`
- Test: `tests/unit/cloze.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no React/Prisma/DOM).
- Produces:
  - `MAX_CLOZE_TEXT = 2000`, `MAX_CLOZE_CARDS = 10`
  - `type ClozePart = { kind: "text"; text: string } | { kind: "cloze"; n: number; answer: string; hint: string | null }`
  - `parseCloze(text: string): ClozePart[]`
  - `clozeNumbers(text: string): number[]` (distinct, ascending)
  - `type ClozePiece = { text: string; role: "plain" | "blank" | "answer" }`
  - `renderCloze(text: string, n: number): { front: ClozePiece[]; back: ClozePiece[] }`
  - `answerFor(text: string, n: number): string`
  - `validateCloze(text: string): { ok: true; text: string; numbers: number[] } | { ok: false; message: string }`
  - `clozeFromSelection(context: string, selected: string): string | null`
  - `spreadSiblings<T extends { id: string; noteId: string | null; question: string; clozeIndex: number | null }>(cards: T[]): { session: T[]; held: number }`

- [ ] **Step 1: Write the failing tests** in `tests/unit/cloze.test.ts` (same style as `tests/unit/exam-prep.test.ts`; import from `@/lib/cloze`). Names and assertions:
  - `a deletion is read with its number, answer and hint`: `parseCloze("The {{c1::heart}} pumps {{c2::blood::fluid}}.")` deep-equals text "The ", cloze 1 "heart" hint null, text " pumps ", cloze 2 "blood" hint "fluid", text ".".
  - `numbers outside 1 to 99, with a leading zero, or without the double colon stay text`: for `{{c0::a}}`, `{{c100::a}}`, `{{c01::a}}`, `{{c1:a}}`, `{{c::a}}`, `{{cx::a}}` every part is `kind: "text"` and the parts' text joined equals the input.
  - `an opener that is never closed, or followed by another opener first, stays text`: `"{{c1::a {{c2::b}}"` gives text `"{{c1::a "` then cloze 2 "b"; `"{{c1::abc"` is one text part.
  - `the first double colon splits answer from hint, later ones belong to the hint`: `{{c1::a::b::c}}` gives answer "a", hint "b::c"; `{{c1::a::}}` gives hint null.
  - `clozeNumbers lists each number once, ascending`: `{{c3::a}}{{c1::b}}{{c3::c}}` gives `[1, 3]`.
  - `renderCloze hides one group and shows the others`: for `"{{c1::A}} and {{c2::B}} and {{c1::C::hint}}"`, n=1 front is blank "…", plain " and B and ", blank "hint"; back is answer "A", plain " and B and ", answer "C"; n=2 front is plain "A and ", blank "…", plain " and C".
  - `renderCloze with a number that has no deletion shows everything plain`, and `answerFor joins a group's answers with a comma` (`"A, C"` for n=1 above).
  - `validateCloze accepts a good text, trims it, and reports its numbers`; refuses (each `ok: false`, message matching the regex in brackets): empty and whitespace-only [/first/i], 2001 characters [/2000/] while exactly 2000 characters is ok, no deletion [/Hide at least one/], eleven distinct numbers [/at most 10/], `{{c1:: }}` [/empty/], `{{c1::a}} and {{c2::b` [/{{c1::answer}}/], a stray `}}` [/{{c1::answer}}/].
  - `clozeFromSelection`: `("Mitochondria make ATP in the cell. They are small.", "ATP")` returns `"Mitochondria make {{c1::ATP}} in the cell."`; `("One. Two has ATP here! Three.", "ATP")` returns `"Two has {{c1::ATP}} here!"`; whitespace is collapsed (`("Mitochondria   make\n ATP   in the cell.", "ATP  in")` returns `"Mitochondria make {{c1::ATP in}} the cell."`); the first of several occurrences is wrapped (`("ATP and ATP.", "ATP")` gives `"{{c1::ATP}} and ATP."`); braces in the context are neutralised and the result still validates (`("Use {{c1::x}} for blanks.", "blanks")` gives `"Use { {c1::x} } for {{c1::blanks}}."` and `validateCloze(result).ok` is true; also `"{{{"` in the context leaves no `{{`); a sentence over 400 characters (150 words `w0 w1 ...` with no punctuation, selecting `w75`) gives a result containing `{{c1::w75}}`, shorter than 300 characters, whose space-separated tokens all match `/^(\{\{c1::)?w\d+(\}\})?$/`; returns `null` for an empty selection, a whitespace-only selection, one not found in the context, and one over `MAX_CLOZE_TEXT`.
  - `spreadSiblings keeps the first card of a cloze text and every basic card, in order`: cards basic A (note n1), cloze (n1, "Q", 1), cloze (n1, "Q", 2), cloze (n2, "Q", 1), basic B, cloze (null note, "Q", 1) gives session ids A, first cloze, the n2 cloze, B, the null-note cloze, and `held` 1.
  - `hostile input of 100,000 characters parses in well under a second`: `"{{c1::".repeat(16667)`; `"{{c1::".repeat(16000) + "}}"`; `"{{c1::{{c2::".repeat(8000) + "}}}}"`; `"{{c1::a::" + "b".repeat(100000) + "}}"` (this one parses to one cloze with a 100,000-character hint); each parse and each `validateCloze` call under 1000 ms (`performance.now()`).

- [ ] **Step 2: Run to verify they fail**
  Run: `pnpm exec node --conditions=react-server --import tsx --test tests/unit/cloze.test.ts` (use the exact command `package.json` defines for `pnpm test`, narrowed to this file).
  Expected: FAIL, "Cannot find module '@/lib/cloze'" or functions not exported.

- [ ] **Step 3: Implement `src/lib/cloze.ts`.** `parseCloze` must be linear: find the next `"{{c"` with `indexOf`; read a number matching `[1-9][0-9]?` then `"::"`; the body ends at the first `"}}"` and may not contain `"{{"`. Keep two cached positions, the next `"}}"` and the next `"{{"` at or after the body start, and recompute one only when it is behind the cursor (and remember "none" so a missing closer is searched for once, not once per opener). An opener that is not a valid deletion stays text and scanning resumes just after its `"{{"`. Hint is everything after the first `"::"` in the body (empty means null). `validateCloze` refuses when `"{{"` or `"}}"` remains in the plain text after parsing. `clozeFromSelection` neutralises braces with `/\{(?=\{)/g` -> `"{ "` and `/\}(?=\})/g` -> `"} "` on both strings before collapsing whitespace and searching; sentence boundaries are `.`, `!`, `?` followed by a space, plus the ends of the context (the caller passes one block, so a line break is not a boundary); over 400 characters it takes up to 120 characters each side, cut to start and end on a space or the end of the context. Merge adjacent plain pieces in `renderCloze`.

- [ ] **Step 4: Run to verify they pass** (same command). Expected: all pass, including the hostile test.

- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/cloze.ts tests/unit/cloze.test.ts
  git commit -m "Add the cloze rules: parse, render, validate, from-selection, siblings"
  ```

---

### Task 2: Column, repository, service, action

**Files:**
- Modify: `prisma/schema.prisma` (Flashcard), `src/repositories/flashcard-repository.ts`, `src/services/flashcard-service.ts`, `src/actions/flashcards.ts`
- Create: `prisma/migrations/20261101120000_flashcard_cloze_index/migration.sql`, `tests/integration/cards.test.ts`

**Interfaces:**
- Consumes: Task 1 (`validateCloze`, `answerFor`, `MAX_CLOZE_TEXT`); `noteRepository.getNote(userId, noteId)` (live, caller's note or null); `courseRepository.listCourseOptions(userId): { id; code; title }[]`.
- Produces:
  - `FlashcardInput` gains `clozeIndex: number | null`.
  - repository: `listDue(userId, now, options?: { deck?: string; take?: number })` where `deck` is a course id or `"none"`; `deckCounts(userId, now): Promise<{ courseId: string | null; total: number; due: number }[]>`; every count and list below uses one private `liveCards(userId)` filter `{ userId, OR: [{ noteId: null }, { note: { deletedAt: null } }] }`: `listDue`, `countCards`, `countDue`, `countDueForCourse` (which keeps its course condition).
  - service: `createCardsForNote(userId, noteId, input: { kind: "basic"; question: string; answer: string } | { kind: "cloze"; text: string }): Promise<{ created: number }>`; `type DeckSummary = { id: string | null; label: string; title: string | null; total: number; due: number }`; `listDecks(userId, now): Promise<DeckSummary[]>`.
  - action: `createCardAction(noteId: string, input: unknown): Promise<ApiResponse<{ created: number }>>`.

- [ ] **Step 1: Write the failing integration tests** in `tests/integration/cards.test.ts` (same shape as `tests/integration/exam-prep.test.ts`: `import "dotenv/config"`, a `newUser()` that registers each account for cleanup in `after`, notes and courses made with Prisma directly, services called with an explicit `userId`, refusals asserted with `AppError.code`). Names and assertions:
  - `a basic card is stored trimmed, with no cloze index` (question/answer trimmed, `clozeIndex` null, `noteId` the note's, one row).
  - `a cloze text makes one card per distinct number, each holding the whole text`: `{{c1::Mitochondria}} make {{c2::ATP}} in the {{c1::cell}}` gives two rows, `clozeIndex` 1 and 2, `question` identical and equal to the trimmed text, `answer` "Mitochondria, cell" and "ATP".
  - `a bad cloze text or a bad basic card writes nothing`: for empty, no deletion, unclosed `{{c1::a`, empty answer, eleven numbers, 2001 characters, and basic with an empty question, a 1001-character question, an empty answer, a 2001-character answer, each rejects with `VALIDATION_ERROR` and the account's card count is unchanged.
  - `another account's note, a trashed note and a missing note are the same refusal`: all three reject `RESOURCE_NOT_FOUND` "That note no longer exists." and nothing is written; and with a foreign note id plus invalid input the code is `VALIDATION_ERROR` (input is checked first).
  - `the deck filter takes a course id, none, and a course that is not yours`: three notes (course A, course B, no course) with one due card each; `listDue(..., { deck: A.id })` is exactly A's card; `{ deck: "none" }` is exactly the no-course card; another account's course id gives `[]`; no option gives all three; ordering by `dueAt` is kept.
  - `a card whose note is in a deleted course is in no course`: soft-delete a course (`deletedAt`), its note's card appears under `deck: "none"` and in `deckCounts` as `courseId: null`, and not under the deleted course's id.
  - `deckCounts counts per course for one account only`: two accounts with cards in the same-named courses; each sees only its own totals; `due` counts only `dueAt <= now`.
  - `cards of a trashed note are neither listed nor counted, and come back when it is restored`: set the note's `deletedAt`; `countDue`, `countCards`, `listDue`, `countDueForCourse`, `deckCounts` all drop them; clear `deletedAt`; all return.
  - `the due count equals the sum of the deck due counts` with a mix of courses, none, a trashed note and a card due tomorrow.
  - `listDecks labels decks from the caller's own courses, leaves out empty ones, and puts No course last`: label is the course code, `title` the course title; a course with no live cards is absent; ordering is due descending then label, with `{ id: null, label: "No course" }` last; the other account's courses never appear.

- [ ] **Step 2: Run to verify they fail**
  Run: `pnpm test:integration -- tests/integration/cards.test.ts` (narrow `pnpm test:integration` to this file the way `package.json` allows).
  Expected: FAIL (missing exports / unknown column `clozeIndex`).

- [ ] **Step 3: Schema and migration.** Add `clozeIndex Int?` to `model Flashcard` (after `answer`). Write the migration SQL by hand: `ALTER TABLE "Flashcard" ADD COLUMN "clozeIndex" INTEGER;`. Do **not** run `prisma migrate dev` and do **not** diff against the dev database: it also holds item 8's four GPA columns, which this branch's schema lacks, so either would propose dropping them (the dev database may be reset by `migrate dev`). Prove the SQL matches the schema with a throwaway database: create `cloze_shadow` in the `nexus-postgres` container (credentials in `.env`), run `pnpm prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --shadow-database-url <url of cloze_shadow> --script` (confirm the flag names with `--help`; this Prisma is 7), expect `-- This is an empty migration.`, then drop `cloze_shadow`. Apply to the dev database with `pnpm prisma migrate deploy`, then `pnpm prisma generate`. If `migrate deploy` complains about item 8's migration being absent locally, stop and report; do not reset anything.
  Expected: "1 migration applied"; `\d "Flashcard"` shows `clozeIndex integer`.

- [ ] **Step 4: Repository.** Implement as in Interfaces. The "none" deck is `OR: [{ noteId: null }, { note: { OR: [{ courseId: null }, { course: { deletedAt: { not: null } } }] } }]`; a course-id deck is `note: { courseId, course: { deletedAt: null } }` (check the relation field name in the schema). `deckCounts` is `$queryRaw` with bound parameters only: `SELECT c."id" AS "courseId", count(*)::int AS total, (count(*) FILTER (WHERE f."dueAt" <= ${now}))::int AS due FROM "Flashcard" f LEFT JOIN "Note" n ON n."id" = f."noteId" LEFT JOIN "Course" c ON c."id" = n."courseId" AND c."deletedAt" IS NULL WHERE f."userId" = ${userId} AND (f."noteId" IS NULL OR n."deletedAt" IS NULL) GROUP BY c."id"`. Delete `countCards` if no caller remains after Task 4 (decide there; leave it for now).

- [ ] **Step 5: Service and action.** `createCardsForNote`: validate the input first (basic: trim, question 1 to 1000, answer 1 to 2000; cloze: `validateCloze`) so a foreign id with bad input says `VALIDATION_ERROR` only; then `getNote(userId, noteId)` or `RESOURCE_NOT_FOUND`; one row per `numbers` entry with `question` the trimmed text, `answer` from `answerFor`, `clozeIndex` the number; `createCards`. `listDecks` joins `deckCounts` to `listCourseOptions`; counts whose course is not among the caller's live courses fold into No course. `createCardAction`: `requireUserId()` first, then Zod (`z.uuid()` for the note; a discriminated union on `kind` with `text` max `MAX_CLOZE_TEXT`, `question` max 1000, `answer` max 2000), service, `revalidatePath("/cards")`, `revalidatePath(\`/notes/${noteId}\`)`, `revalidatePath("/")`, `toApiResponse`.

- [ ] **Step 6: Run to verify they pass.** Run: `pnpm test:integration` and `pnpm test`. Expected: the new file passes and the existing suites still pass (the live-card filter must not break `tests/integration/exam-prep.test.ts`).

- [ ] **Step 7: Commit** (`prisma/schema.prisma`, the migration folder, the three source files, the test).
  ```bash
  git commit -m "Store cloze cards, derive decks from the note's course, count only live cards"
  ```

---

### Task 3: Making cards (`CardMaker`, tray, selection)

**Files:**
- Create: `src/components/card-maker.tsx`, `tests/e2e/cards.spec.ts`
- Modify: `src/components/note-view.tsx` (wrap `body` in `<div data-note-body className="min-w-0">` in the reading view only), `src/app/(dashboard)/notes/[id]/page.tsx` (the section under the note renders `GenerateCards` and `CardMaker` together)

**Interfaces:**
- Consumes: Task 1 (`validateCloze`, `clozeNumbers`, `renderCloze`, `clozeFromSelection`, `MAX_CLOZE_TEXT`), Task 2 (`createCardAction`).
- Produces: `CardMaker({ noteId }: { noteId: string })`. Accessible names that Task 4's tests use: button "New card"; dialog "New card" with radios "Fill in the blank" / "Question and answer" in a group "Kind of card"; textarea "Text with blanks"; button "Hide selected words"; fields "Question" and "Answer"; submit "Add card" / "Add N cards"; "Cancel"; tray = group "Make a card from the selection" with buttons "Fill in the blank" and "Question and answer"; an always-mounted `role="status"` line "Added N card(s)."

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/cards.spec.ts` (helpers in the style of `tests/e2e/exam-prep.spec.ts`: a `main(page)`; `makeNote(page, { title, content, course? })` through `/notes/new` using the labels the form really has: open `src/components/note-editor.tsx` and read them first). Tests:
  - `a card by hand: the text with blanks makes one card per number`: open a note, "New card", fill "Text with blanks" with `{{c1::Paris}} is the capital of {{c2::France}}`, see "This makes 2 cards", click "Add 2 cards": dialog closes, status "Added 2 cards.", the section shows "2 cards from this note".
  - `Hide selected words wraps the selection in the next number`: set the textarea to `Paris is the capital of France`, select `Paris` with `setSelectionRange` in `page.evaluate`, click the button: value starts `{{c1::Paris}}`; select `France`, click: contains `{{c2::France}}`.
  - `double-clicking a word in the note offers a blank, prefilled with its sentence`: note body `Mitochondria make ATP in the cell. They are small.`; double-click `ATP`; the group "Make a card from the selection" is visible; "Fill in the blank"; the textarea value is `Mitochondria make {{c1::ATP}} in the cell.`; Add; status "Added 1 card.".
  - `question and answer from a selection puts the selection in the answer`: same word, "Question and answer": Answer is the selected text, Question is empty and "Add card" is disabled until a question is typed.
  - `a selection in the note's title or side rail shows no tray`: double-click a word of the `h1`; the tray group has count 0.
  - `a formula in the selection appears once, as $...$`: body `The area is $\pi r^2$ for a circle.`, triple-click the paragraph, "Question and answer": Answer equals `The area is $\pi r^2$ for a circle.`.
  - `braces written in a note are neutralised in the prefill and the card still saves`: body `Use {{c1::x}} for blanks.`, double-click `blanks`, "Fill in the blank": value is `Use { {c1::x} } for {{c1::blanks}}.`; Add succeeds.
  - `a double click on Add makes one set of cards`: `dblclick` on the submit; status "Added 1 card." and the section says "1 card from this note".
  - `the tray and the dialog fit a phone, in light and dark`: for each colour scheme (emulate it the way `tests/e2e/workspace.spec.ts` does for the theme tests; search it for `data-theme`/`emulateMedia`), at 375x812: no horizontal overflow (`document.documentElement.scrollWidth <= innerWidth`), tray buttons and every dialog control at least 44px tall, the dialog's box inside the viewport.

- [ ] **Step 2: Run to verify they fail**
  Run: `pnpm exec playwright test tests/e2e/cards.spec.ts`
  Expected: FAIL, "New card" button not found.

- [ ] **Step 3: Implement `CardMaker`** as in the design. Client component; state: `selection: { text: string; context: string } | null`, `open`, `kind`, `text`, `question`, `answer`, `status`, `error`; `useTransition` for the submit. A `selectionchange` listener on `document` (set in an effect; state is set from the listener, never synchronously in the effect body) shows the tray only when the range's `commonAncestorContainer` is inside `[data-note-body]` and the selection is not collapsed. Selected text and the context (nearest `p, li, blockquote, h1-h6, td, th, dd, dt, pre` ancestor of the range start, or the selection itself) are read through one `plainText(node)` helper: on a clone, replace each `.katex` by `$` + its `annotation[encoding="application/x-tex"]` text + `$`, or, if it has no annotation (a partial selection), remove its `.katex-mathml` and keep the rest, then take `textContent`. Prefill: cloze = `clozeFromSelection(context, selected)`, falling back to the selection (cut to 400 characters) unwrapped when that returns `null`; Q&A = Answer is the selection cut to 2000 characters. "New card" reads the current selection when clicked, so a keyboard user gets the same prefill; the tray and the "Hide selected words" button call `preventDefault` on `mousedown` so they do not steal the selection. "Hide selected words" wraps the textarea selection in `{{cN::...}}` with N one more than the highest number present (disabled with no textarea selection or when N would pass 99) and puts the caret after it. Live help under the textarea: "This makes N cards" plus each card's front (`renderCloze`) when `validateCloze` is ok, otherwise its message in muted text, never `role="alert"`. Submit is disabled while pending or invalid, shows "Adding…" while pending, closes the dialog and sets the status on success, and shows `result.error.message` in a `role="alert"` inside the dialog on failure. Dialog: native `<dialog>` opened with `showModal()`, `aria-labelledby` its heading, `w-[calc(100vw-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto`, focus moved to the text field after opening, Escape and Cancel close it and reset the fields. The tray is `fixed`, hidden while the dialog is open, `z-20`, at `bottom-[calc(4.5rem+env(safe-area-inset-bottom))]` on a phone (above the tab bar) with `right-[5.5rem]` so it clears the assistant dock, and `sm:bottom-6` centred on wide screens; its buttons wrap and are `min-h-11`.

- [ ] **Step 4: Wire the note page.** `NoteView` wraps `body` in the marked div (reading view only, so a selection in the editor's textarea never shows the tray); the page's section becomes a column holding `GenerateCards` and `CardMaker noteId={note.id}`.

- [ ] **Step 5: Run to verify they pass.** Run: `pnpm exec playwright test tests/e2e/cards.spec.ts`, then the existing specs this can disturb: `pnpm exec playwright test tests/e2e/workspace.spec.ts tests/e2e/link-suggestions.spec.ts` (the note page gained a button and a wrapper div; the very-wide-formula phone test in `workspace.spec.ts` guards the wrapper).
  Expected: all pass. If an old selector is now ambiguous, fix the old selector to be more specific, not the new name.

- [ ] **Step 6: Commit** (`card-maker.tsx`, `note-view.tsx`, the note page, `tests/e2e/cards.spec.ts`).
  ```bash
  git commit -m "Make cards by hand or from selected text"
  ```

---

### Task 4: Decks and the cloze review

**Files:**
- Create: `src/components/deck-nav.tsx`
- Modify: `src/app/(dashboard)/cards/page.tsx`, `src/components/card-review.tsx`, `src/app/(dashboard)/courses/[id]/page.tsx`, `tests/e2e/cards.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`renderCloze`, `spreadSiblings`), Task 2 (`listDue(userId, now, { deck, take })`, `listDecks`, `DeckSummary`), Task 3 (the "New card" dialog and its names, to make cards in tests).
- Produces: `DeckNav({ decks, active, all }: { decks: DeckSummary[]; active: string | null; all: { total: number; due: number } })` (`active` is a course id, `"none"` or `null` for all); `ReviewCard` gains `clozeIndex: number | null`.

- [ ] **Step 1: Add the failing e2e tests** to `tests/e2e/cards.spec.ts`. The shared test account holds other specs' cards, so each test makes its own uniquely coded courses and reads No course counts relative to before. Tests:
  - `each course is a deck with its own count, and choosing one limits the queue`: two courses, a note in each with two and one basic cards, a note with none; the nav (role navigation "Decks") links "All decks", each course code with "2 due" / "1 due", and "No course"; choosing the first deck sets `?course=<id>`, marks it `aria-current`, shows only its two questions and "1 of 2".
  - `a course that is not yours is an empty deck and a garbage value is all decks`: `/cards?course=<random uuid>` shows "Nothing due right now." and no deck is current; `/cards?course=abc` behaves as all decks.
  - `a fill-in-the-blank card shows a blank, then the answer in place`: make `{{c1::Paris}} is the capital of France` by hand; in `/cards?course=...` (or all) the card text contains `[…]` and not `Paris`; "Show answer" reveals `Paris` and drops the blank; "Good" ends the queue ("That's the queue cleared.").
  - `a hint replaces the dots`: `{{c1::Paris::city}}` shows `[city]`.
  - `the second card from one text waits for the next session`: `{{c1::A}} and {{c2::B}}`; the queue shows 1 card and says 1 is held back; after grading it "Good" and reloading, the other appears.
  - `trashing the note removes its cards from the deck and the queue, and restoring brings them back`: delete the note from its page (the native `confirm`, answered with `page.once("dialog", ...)`), `/cards` and the deck nav lose it; restore from `/trash`, they return.
  - `the course page links to its own deck`: `/courses/<id>` shows "Review this deck" going to `/cards?course=<id>`.
  - `the deck nav fits a phone, in light and dark`: 375px, no horizontal overflow, each deck link at least 44px tall.

- [ ] **Step 2: Run to verify they fail.** Run: `pnpm exec playwright test tests/e2e/cards.spec.ts`. Expected: the new tests FAIL (no deck nav; cloze text shows its markers).

- [ ] **Step 3: Implement.**
  - `cards/page.tsx`: read `searchParams` (a Promise); accept the `course` value only when it is a single string that is a uuid or `"none"`, otherwise all; fetch `listDecks` and `listDue(userId, now, { deck, take: 200 })`; `spreadSiblings`, then slice to 50; header counts come from `listDecks` (the sum for all decks, the matching entry for a deck, 0 for an unknown one); say how many are held back ("N more from the same text wait for your next session"). If `countCards` has no caller left, delete it from the repository and its tests.
  - `deck-nav.tsx`: a server-compatible `<nav aria-label="Decks">` of links, `aria-current="page"` on the active one, each showing label, `{due} due` and the total, wrapping, `min-h-11`; the course title as the link's `title`.
  - `card-review.tsx`: for `clozeIndex !== null` render `renderCloze(card.question, card.clozeIndex)`: blank pieces as `[text]` in a visibly distinct span, answer pieces bold and underlined (not colour alone), plain pieces as text; on "Show answer" the front swaps to the back and no separate answer block appears. Basic cards unchanged.
  - course page: the existing due-flashcards link uses `/cards?course=${course.id}`; show "Flashcards: {due} due of {total} · Review this deck" whenever the course's deck has cards (read from `listDecks`).

- [ ] **Step 4: Run to verify they pass.** Run: `pnpm exec playwright test tests/e2e/cards.spec.ts`, then `pnpm test:integration`. Expected: all pass.

- [ ] **Step 5: Commit**
  ```bash
  git commit -m "Review cards by course deck, with fill-in-the-blank cards and held-back siblings"
  ```

---

### Task 5: Guard, measure, record

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `ROADMAP.md`

**Interfaces:** none new.

- [ ] **Step 1: Security review** of the whole diff with the `security-review` skill. Check specifically: `createCardAction` order (session, Zod, service), `noteId` only used in a `userId`-scoped read, the `course` parameter only inside `userId`-scoped queries, `deckCounts` bound parameters only, no HTML sink (`dangerouslySetInnerHTML`, `innerHTML`) in `card-maker.tsx` or `card-review.tsx`, and that the DOM text taken from the note never leaves the browser except as the person's submitted text. Fix any real finding test-first.

- [ ] **Step 2: Measure, do not read.** Scratch script (outside the repo, run with `--env-file=.env`): time `parseCloze` and `validateCloze` on the four hostile 100,000-character inputs; create 5,000 cards across 20 courses for a throwaway account and time `deckCounts`, `listDue` and `countDue`; delete the account. Record the numbers.

- [ ] **Step 3: Mutation-check** each rule, backing up the file first (verify the backup exists and is non-empty), editing with `perl -0pi`, running the narrowest test that should catch it, then restoring and `diff -q`: drop the `liveCards` filter; make the deck filter ignore the course; let `spreadSiblings` return every card; skip the `getNote` ownership read; remove the stray-brace check in `validateCloze`; drop the brace neutralising; drop the `data-note-body` check in the selection handler; drop `disabled` while pending. Each must make a test fail. A mutation that survives means a weak test: fix the test.

- [ ] **Step 4: `simplify`, then the check chain**: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, `pnpm build`. Start Ollama (`ollama serve`) and run the whole `pnpm test:e2e` at normal priority, one worker. Report any failure by name, including ones you did not cause. Then look at it in the browser at desktop and 375px, light and dark: the tray over a long note, the dialog, the deck nav, a cloze card front and back.

- [ ] **Step 5: Record.** `CLAUDE.md`: new section "Cloze cards, decks and cards from selection" (before "Trash and soft-delete recovery" is fine) holding the five decisions with their costs, the grammar, the measured numbers, what testing and review turned up, and **Not done** (editing a card, a card browser, deleting outside review, a stored `courseId`, note-less cards, maths in cards, cloze from the AI generator, moving a card between decks, image occlusion; the JSON export still omits cards and item 11 must include `clozeIndex`; the migration was verified by a shadow-database diff and applied with `migrate deploy`, not rehearsed in a container locally). Amend the Exam prep line "The review queue (`/cards`) is not filtered by course" and its "Not done" entry. `README.md`: the Cards bullet. `ROADMAP.md`: tick item 9.

- [ ] **Step 6: Review and ship.** Run `code-review` on the diff and fix what it finds test-first. Commit the docs. Push `cloze-cards` and open the pull request with `gh` (body: what it does, the decisions, what was verified and what was not, ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`), then `get_status` once and report the checks once. **If the network is still unreachable, stop with everything committed locally and say so; do not retry in a loop.**
