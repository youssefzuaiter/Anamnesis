# Link suggestions and unlinked mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a note's page, suggest notes worth linking to (close in meaning, or named in the text) and show other notes that mention this note's title without linking to it; a link is added only when the person clicks, and always as a bullet under a "See also" heading.

**Architecture:** Suggestions come from vectors that are already stored (`findSimilarEntities`, no model call at page view), plus a pure scan of this note's text for other notes' titles. Mentions of this note come from a case-insensitive text query narrowed by a pure whole-word check that ignores code, links and URLs. One service function, `addLink(from, to)`, appends `[[Title]]` under the note's "See also" section through the existing `updateNote`, so the version snapshot, re-index and link sync all happen the way every other save does, and the change is undoable from History. Nothing is written when a page loads.

**Tech Stack:** Next.js 16 server components and Server Actions, Prisma 7, Zod, Tailwind (Quiet Studio tokens). No new dependency, no migration, no new model call.

**Spec:** ROADMAP item 7: "'This note is close to X, link it?' from the existing embeddings. Suggestions never write a link by themselves." (Tagged *model?*, not *demo*.) Decisions made while shaping, binding on this plan:
- **The action is "append to See also", not "rewrite the mention".** The alternatives were rewriting the plain-text mention into `[[...]]` in place (needs a Markdown-aware rewrite that must skip code, math, links and URLs, and a wrong rewrite corrupts someone's text) or pre-filling the editor (the rail and the editor are separate client trees). Appending a bullet changes nothing the person wrote, is the same edit for every kind of suggestion, and is undoable from History. Council run inline by me, so weaker than independent voices. Cost: the link sits in a footer section, not at the word.
- **Three sources, two cards.** "Suggested links" (outgoing): notes that are close in meaning and notes whose titles this note names, merged, a note that is both shown once. "Mentions this note" (incoming): other notes that mention this note's title without linking to it, with a button that adds a link in *that* note.
- **A suggested link must open the note it names.** `resolveNoteTitles` sends an ambiguous title to the most recently updated note bearing it, so a `[[Title]]` shared by two notes would silently open the other one. Such titles are never suggested and `addLink` refuses them. Titles containing `[`, `]` or a newline cannot be written as a link and are excluded the same way.
- **The similarity floor is measured, not guessed.** Under `nomic-embed-text` (2026-10-29, 12 short notes in 5 fields): notes in the same field scored 0.60 to 0.81 (n=26, median 0.67, p90 0.79); notes from different fields 0.47 to 0.71 (n=106, median 0.55, p90 0.65). They overlap, so there is no clean cut. At a floor of 0.70, 10 of 26 same-field pairs are kept and 2 of 106 cross-field ones (about 83% precision, 38% recall); at 0.60, 24 of 26 and 34 of 106. A wrong suggestion costs the person's attention and a missed one costs nothing (the Related card still lists the nearest items), so the floor favours precision: **0.70**. The sample is small, synthetic and made of one- or two-sentence notes; a long note has many chunks and is scored by its best one, which can only push its scores up. The number is model-specific: re-measure it if the embedding model changes.
- **No demo.** The entry is tagged *model?*, not *demo*; the UI is two rail cards in the existing patterns (`NoteLinks`, `RelatedItems`), built and looked at in the browser.

## Global Constraints

- No paid service, no new dependency, no migration, and no model call when a page loads (the vectors are already stored; mentions are text).
- `lib/see-also.ts` and `lib/mentions.ts` have no React and no Prisma import, so they are unit-testable.
- Every query is scoped by the session's `userId`; a client-sent id is ownership-checked by a scoped lookup; both notes of `addLink` must be the caller's own live notes.
- Loading a page never writes. A note changes only when a person presses a button that calls `addLinkAction`.
- Constants, exact values: `SUGGESTION_MIN_SIMILARITY = 0.7`, `MAX_SUGGESTIONS = 5`, `MAX_MENTIONS = 5`, `MIN_MENTION_TITLE_LENGTH = 5`, `SEE_ALSO_HEADING = "See also"`, the note size limit `MAX_NOTE_LENGTH = 100_000` (the editor's own).
- Copy is exact: cards `Suggested links` and `Mentions this note`; reasons `Close in meaning`, `Named in this note`; buttons `Add link` and `Add link there`; help line under `Mentions this note`: `Adding a link puts this note under "See also" in that note.`; status `Added to See also. You can undo it from History.`; already linked `Already linked.`
- Run heavy commands with `nice -n 19`. Playwright selects by label and by `main` (CLAUDE.md "Testing UI with Playwright").

## Review Focus

1. Opening a note page, any number of times, changes no note: no new version, same content. (Task 3)
2. Another account's notes never appear as a suggestion or a mention, even when the nearest or the only one naming the title, and `addLink` with another account's id is refused. (Task 2)
3. A title shared by two notes is never suggested, and `addLink` refuses it; a title containing brackets is excluded and refused. (Tasks 1 and 2)
4. A note that is already linked is not suggested, and adding a link twice adds one bullet, not two. (Tasks 1 and 2)
5. The "See also" edit is right for every shape of note: a section already there, none, an unterminated code fence, no trailing newline, many trailing newlines, a length that would pass the limit. (Task 1)
6. A mention inside a code block, inline code, a Markdown link, a URL or another `[[link]]` does not count; matching is whole-word and case-insensitive; a title with regular-expression characters (`C++ (basics)`) is matched literally. (Task 1)
7. Soft-deleted notes are never suggested or counted as mentions. (Task 2)
8. Adding a link snapshots the previous text, so History can undo it, and keeps the note's title, tags, favourite, project and course. (Task 2)
9. With Ollama off, suggestions still come from stored vectors and mentions need no model. (Task 2)
10. On a phone the buttons are at least 44px and the page does not widen. (Task 3)

---

### Task 1: The pure parts

**Files:**
- Create: `src/lib/see-also.ts`, `src/lib/mentions.ts`, `tests/unit/see-also.test.ts`, `tests/unit/mentions.test.ts`

**Interfaces:**
- Consumes: `parseWikiLinks`, `normalizeTitle` from `lib/wiki-links.ts`.
- Produces:
  - `src/lib/see-also.ts`: `SEE_ALSO_HEADING`, `MAX_NOTE_LENGTH`; `canLinkTitle(title: string): boolean` (trimmed, not empty, at most 200 characters, no `[`, `]` or line break); `linksTo(content: string, title: string): boolean` (the content already has a `[[...]]` whose normalized text equals the title's); `appendSeeAlso(content: string, title: string): { content: string; added: boolean }` (`added` false when `linksTo` already holds, content unchanged).
  - `src/lib/mentions.ts`: `MIN_MENTION_TITLE_LENGTH`; `mentionSnippet(content: string, title: string): string | null`: null unless `title` appears in `content` as whole words, case-insensitively, outside fenced code, inline code, `[[...]]`, Markdown links and bare URLs; otherwise about 90 characters of the surrounding text on one line, with the match inside.

Behaviour of `appendSeeAlso` (the signature and tests do not determine it): if a line equal to `## See also` (any case, trailing spaces allowed) exists, the new bullet `- [[Title]]` goes at the end of that section, that is before the next heading or at the end of the text, with no blank line between bullets; if there is none, `\n\n## See also\n\n- [[Title]]\n` is appended (one blank line before the heading however many newlines the text ended with, none added to an empty note); if the text has an unterminated fence (an odd number of lines starting with three backticks or three tildes), the fence is closed first so the new section is not inside it; the result always ends with a single newline.

- [ ] **Step 1: Write the failing tests.** `tests/unit/see-also.test.ts` (node:test): `canLinkTitle`: true for `Gradient descent`, `C++ (basics)`, `Lecture 4 · Backpropagation`; false for `""`, `"   "`, `"a[b"`, `"a]b"`, `"a\nb"`, 201 characters. `linksTo`: true for `[[Gradient descent]]`, `[[ gradient   DESCENT ]]`; false for `[[Gradient descent intro]]` and plain text. `appendSeeAlso`: (1) no section, text `"Intro.\n"` gives `"Intro.\n\n## See also\n\n- [[X]]\n"`; (2) text with no trailing newline and with three trailing newlines give the same result as (1); (3) an empty note gives `"## See also\n\n- [[X]]\n"` (no leading blank lines); (4) an existing `## See also` section at the end gets `- [[X]]` after its last bullet, with the earlier bullets untouched and still one newline at the end; (5) a `## See also` section followed by `## Next` gets the bullet before `## Next`; (6) `## see also  ` (case, trailing spaces) is recognised; (7) already linked returns `{ added: false }` and the same text; (8) an unterminated fence (`` ```js\ncode\n``) gets a closing fence line before the new section; a balanced fence is left alone; (9) a title with `C++ (basics)` is written as `[[C++ (basics)]]`; (10) the result of `appendSeeAlso` always satisfies `linksTo`.
  `tests/unit/mentions.test.ts`: whole word, case-insensitive: `"I revised gradient descent today"` mentions `Gradient descent`; `"gradient descents"`, `"subgradient descent"` and `"Gradient descent2"` do not; a mention at the very start and at the very end of the text counts; a title with regular-expression characters (`C++ (basics)`) is matched literally and does not match `C (basics)`; a Unicode title (`Öğrenme oranı`, `Çalışma planı`) is matched, and an uppercase `İ` / lowercase `i` pair is not required to match (Turkish dotted letters are not folded); excluded places: inside a fenced block, inside `` `inline code` ``, inside `[text mentioning it](https://x)` as link text and as a URL, inside `https://example.com/gradient-descent`, inside `[[Gradient descent]]` (an existing link) and inside `[[Gradient descent intro]]`; a mention outside those places in the same text still counts; a title shorter than `MIN_MENTION_TITLE_LENGTH` never counts; the snippet is one line, at most about 90 characters, contains the title as written in the text, and has no Markdown fence characters.
- [ ] **Step 2: Run to confirm failure.** Run: `nice -n 19 pnpm exec tsx --conditions=react-server --test tests/unit/see-also.test.ts tests/unit/mentions.test.ts` — Expected: FAIL, cannot find the modules.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run to confirm pass,** then `nice -n 19 pnpm test` and `pnpm exec tsc --noEmit`. Mutation-check four rules, restoring after each: a mention inside a code fence counts; the whole-word boundary dropped; a title is interpolated into the regular expression without escaping; `appendSeeAlso` ignores an existing section and always adds a new one; each must fail a test.
- [ ] **Step 5: Commit** the plan, both modules and the tests ("Add the pure parts of link suggestions").

---

### Task 2: The suggestions, the mentions and `addLink`

**Files:**
- Create: `src/services/link-suggestion-service.ts`
- Modify: `src/repositories/note-repository.ts` (or a new `mention-repository.ts`) for the two reads below
- Test: `tests/integration/link-suggestions.test.ts`

**Interfaces:**
- Consumes: Task 1; `findSimilarEntities`; `resolveNoteTitles`, `getOutgoingLinks`, `getBacklinks`; `noteService.updateNote`; `AppError`.
- Produces:
  - Repository (Prisma only, every query scoped by `userId`): `listNoteTitles(userId, excludeId): Promise<{ id: string; title: string }[]>` (live notes); `listNotesContaining(userId, text, excludeIds, take): Promise<{ id: string; title: string; content: string }[]>` (live notes whose content contains `text` case-insensitively, through Prisma's `contains` with `mode: "insensitive"`, which escapes wildcard characters; never raw SQL).
  - `type LinkSuggestion = { id: string; title: string; reasons: ("similar" | "named")[]; similarity: number | null; snippet: string | null }` and `SUGGESTION_MIN_SIMILARITY`, `MAX_SUGGESTIONS`, `MAX_MENTIONS`.
  - `suggestLinks(userId, noteId): Promise<LinkSuggestion[]>`: `[]` for a note that is not the caller's. Candidates: similar notes from `findSimilarEntities(userId, "note", noteId, 20, ["note"])` with similarity at least the floor, and notes whose titles this note's text mentions (`mentionSnippet`, titles of at least `MIN_MENTION_TITLE_LENGTH` characters). Drop the note itself, notes this note already links to, notes with a title that cannot be linked or is shared with another live note, and anything not resolving through `resolveNoteTitles` to that note. A candidate that is both appears once with both reasons. Order: named first, then by similarity, then by title; at most `MAX_SUGGESTIONS`. A failure of the similarity lookup (Ollama or the vectors unavailable) leaves the named ones, never an error.
  - `findMentionsOf(userId, noteId): Promise<LinkSuggestion[]>`: other live notes whose content mentions this note's title (query first, then `mentionSnippet` to confirm), excluding notes that already link to this one (`getBacklinks`) and, when this note's own title is not linkable or is shared with another live note, returning `[]`. At most `MAX_MENTIONS`, most recently updated first; `reasons` is `["named"]`, `similarity` null, `snippet` the snippet.
  - `addLink(userId, fromId, toId): Promise<{ added: boolean; fromTitle: string; toTitle: string }>`: both notes must be the caller's own live notes (`RESOURCE_NOT_FOUND` otherwise, the same for another account's id and for one that does not exist); `fromId === toId` is `VALIDATION_ERROR`; a target title that cannot be linked or does not resolve to the target is `VALIDATION_ERROR` with a message saying why ("That title can't be written as a link: it has brackets." / "Another note has the same title, so a link would open that one instead. Rename one of them first."); `appendSeeAlso`; a result longer than `MAX_NOTE_LENGTH` is `VALIDATION_ERROR` ("That note is too long to add another link."); an already present link returns `{ added: false }` and writes nothing; otherwise `noteService.updateNote(userId, fromId, { ...the note's own title, tags, isFavorite, projectId, courseId, content })`.

- [ ] **Step 1: Write the failing integration tests** in `tests/integration/link-suggestions.test.ts` (header and per-test throwaway users like `tests/integration/scope.test.ts`; synthetic vectors built in the test as there: `unit(i)`, `nearQuery`, the same raw `INSERT`; notes made with `prisma.note.create`; vectors inserted for the notes that should be similar):
  1. *similar notes at or above the floor are suggested, with their similarity; below it are not*: A with notes N0 and three others with vectors giving similarities 0.95, 0.72, 0.69 to N0 and a fourth with 0.40: the first two are suggested in that order, the others are not; `reasons` is `["similar"]`.
  2. *a note named in this note's text is suggested even with no vector*: N0's content says "see gradient descent" and a note titled `Gradient descent` exists with no embedding: suggested with `["named"]` and a snippet; a title shorter than five characters is not.
  3. *both reasons merge into one entry*: a note that is both similar and named appears once, with `["named", "similar"]`, ranked first.
  4. *exclusions*: N0 itself; a note N0 already links to (`[[Title]]` in its content, links synced through `noteService`-style `replaceOutgoingLinks`, or by creating the link rows directly); a soft-deleted note; a title with brackets; two live notes with the same title (neither is suggested).
  5. *another account*: B's note is the nearest vector to N0 and B has a note titled exactly as one named in N0's text: neither is suggested; `findMentionsOf` for A's note never lists B's notes even when they contain its title; `addLink(A, noteOfA, noteOfB)` and `addLink(B, ...)` with A's ids are `RESOURCE_NOT_FOUND`.
  6. *the similarity lookup failing leaves the named ones*: with `findSimilarEntities` unavailable (call `suggestLinks` for a note whose id has no stored vectors, and, separately, drop the `WorkspaceEmbedding` rows) the named suggestions are still returned and nothing throws.
  7. *mentions of this note*: notes M1 (plain mention), M2 (mention only inside a code fence), M3 (mention only inside `[[Longer title]]`), M4 (already links to this note), M5 (soft-deleted, mentions it), and an unrelated note: only M1 is returned, with its snippet; a note whose title is shared with another live note returns `[]`; the cap `MAX_MENTIONS` holds with eight mentioning notes (most recently updated first).
  8. *addLink appends under See also and is undoable*: after `addLink(A, from, to)` the note's content ends with the See also section containing `- [[To title]]`; `getOutgoingLinks` now includes the target (links synced); a version row exists holding the previous text; the title, tags, favourite flag, project and course are unchanged; `updatedAt` moved.
  9. *adding twice adds one bullet*: the second call returns `{ added: false }`, the content is identical, and no second version is written.
  10. *refusals*: `fromId === toId`; a target with a bracketed title (created directly); a target whose title is shared with a newer note (the link would open the other one); a note near the length limit (content of `MAX_NOTE_LENGTH - 5` characters) is `VALIDATION_ERROR` and unchanged; a soft-deleted note as either side is `RESOURCE_NOT_FOUND`.
- [ ] **Step 2: Run to confirm failure.** Run: `nice -n 19 pnpm exec tsx --conditions=react-server --env-file=.env --test tests/integration/link-suggestions.test.ts` — Expected: FAIL, cannot find `@/services/link-suggestion-service`.
- [ ] **Step 3: Implement** the repository reads and the service.
- [ ] **Step 4: Run to confirm pass.** The Step 2 command, then `nice -n 19 pnpm test:integration`, `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`. Mutation-check five rules, restoring after each (back up each file first and check the backup exists): drop `userId` from the title query; stop excluding notes already linked; skip the ambiguity check in `addLink`; skip the "does not resolve to the target" check; write the content without `updateNote` (a direct repository update, so no snapshot); each must fail a test.
- [ ] **Step 5: Commit** ("Suggest links and find unlinked mentions, and add a link on request").

---

### Task 3: The action, the two cards and the browser tests

**Files:**
- Create: `src/actions/link-suggestions.ts`, `src/components/link-suggestions.tsx`, `tests/e2e/link-suggestions.spec.ts`
- Modify: `src/app/(dashboard)/notes/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `addLinkAction(fromId: string, toId: string): Promise<ApiResponse<{ added: boolean }>>` (`"use server"`; both ids `z.uuid()`, `requireUserId()`, the service, `revalidatePath` for `/notes`, `/notes/{fromId}` and `/notes/{toId}`, `toApiResponse`).
  - `LinkSuggestions` (server component) and `MentionsOfThis` (server component) rendering the two cards from the lists, and a `"use client"` `AddLinkButton({ fromId, toId, label })` that calls the action, then `router.refresh()`, and shows a `role="status"` line (`Added to See also. You can undo it from History.`, or `Already linked.`) or a `role="alert"` with the error. Each row: the note's title as a link to it, the reason (`Close in meaning · 0.78` / `Named in this note`, both joined by ` · `), the snippet for a mention, and the button (min height 44px). Cards render nothing when their list is empty (no empty-state text). The page calls `suggestLinks` and `findMentionsOf` in its existing parallel fetch and puts the two cards in the rail after `NoteLinks` and before `RelatedItems`.

- [ ] **Step 1: Write the failing e2e tests** (`tests/e2e/link-suggestions.spec.ts`; the small `main(page)` helper; notes made through the New note form as `workspace.spec.ts` does; the first test's notes must be made in a fixed order so titles are known):
  1. *a named note is suggested and Add link adds it under See also*: notes `Gradient descent` and `Study log` (content "revised gradient descent today"); on `Study log`'s page the card `Suggested links` lists `Gradient descent` with `Named in this note`; `Add link` shows the status; the reading view then shows a `See also` heading and a link to `Gradient descent`; the note is no longer suggested; `Links to · 1` appears in the links card.
  2. *a mention of this note can be linked from the other note*: on `Gradient descent`'s page the card `Mentions this note` lists `Study log` with a snippet containing "gradient descent" and the help line; `Add link there` shows the status; the page no longer lists it; opening `Study log` shows its See also link.
  3. *opening a page changes nothing*: read a note's content through its edit view before and after opening its page three times and its History page: identical, and History lists no versions created by the visits.
  4. *History can undo it*: after adding a link, `/notes/{id}/history` lists a version, and restoring it removes the See also section.
  5. *a shared title is never offered*: two notes titled `Reading list` and a third note naming "reading list": the third's page does not list `Reading list` under Suggested links.
  6. *no cards when there is nothing*: a note with no relatives shows neither card heading.
  7. *phone*: at 375px wide the note page with a suggestion has no horizontal overflow and `Add link` is at least 44px tall.
- [ ] **Step 2: Run to confirm failure.** Run: `nice -n 19 pnpm exec playwright test tests/e2e/link-suggestions.spec.ts` (the dev server on port 3100 must be running) — Expected: FAIL.
- [ ] **Step 3: Implement** the action, the components and the page wiring, in the style of `note-links.tsx`, `related-items.tsx` and `plan-day.tsx`.
- [ ] **Step 4: Run to confirm pass,** then `nice -n 19 pnpm test:e2e` — Expected: every test passes, including the existing note, backlink and graph tests (the new cards must not make `main`'s first list item ambiguous: CLAUDE.md "A note reads before it edits").
- [ ] **Step 5: Commit** ("Add the suggested-links and mentions cards to the note page").

---

### Task 4: The evals

**Files:**
- Modify: `tests/ai/evals.ts`

- [ ] **Step 1: Write the section** "Link suggestions" after "Note backlinks" in `tests/ai/evals.ts` (real embeddings, through the harness's `owner` and `intruder`): four notes about optimisation (gradient descent, backpropagation, regularisation, convolutional networks), one about the thesis, two about cooking, an intruder note almost identical to the owner's gradient-descent note. Checks: a related note above the floor is suggested for the gradient-descent note (backpropagation and regularisation, which measured 0.81 and 0.75); a cooking note is not; the intruder's note is never suggested and `findMentionsOf` never lists it; an already-linked note is not suggested; every suggested similarity is at least `SUGGESTION_MIN_SIMILARITY`; no suggestion is made for a note with no stored vector (Ollama was down when it was saved) beyond the named ones. Print the measured similarity of each suggested pair (`NOTE` lines) so a model change is visible in the log. Clean up everything the section creates.
- [ ] **Step 2: Run it** against the real embedder through a throwaway slice of the harness (setup, this section, teardown) with Ollama running; the whole suite is run by CI. Mutation-check: lower the floor to 0.5 (the cooking check must fail), and drop `userId` in the similarity join's caller (the intruder check must fail).
- [ ] **Step 3: Commit** ("Add the link-suggestions section to the evals").

---

### Task 5: Guard, check, record, ship

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `ROADMAP.md`

- [ ] **Step 1: Guard.** Run the `security-review` skill over the diff. What to check: both ids of `addLink` are ownership-checked by scoped lookups; every query carries `userId`; the text query uses Prisma's `contains` (no raw SQL, wildcard characters escaped); the snippet rendered on the page is plain text; no page load writes; the title written into a note is one that passed `canLinkTitle` and resolves to the target; errors are static. Ledger what it found and correct anything assumed rather than read.
- [ ] **Step 2: Simplify.** Run the `simplify` skill over `git diff <BASE>..HEAD -- src tests`; behaviour-preserving only. Look at the page's fetches: related items and suggestions both run a self-join over the same vectors; decide whether one query can serve both.
- [ ] **Step 3: Check.** `nice -n 19` for each: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e`. Then look at a note page on a throwaway account (named with the `e2e` prefix, deleted afterwards, and never run Playwright while it exists: the teardown deletes it): desktop and 375px, light and dark: a suggestion by name and by meaning, the mentions card, adding a link, the See also section in the reading view, History restoring it. Seed notes through the real note service so they are embedded.
- [ ] **Step 4: Review.** Read `requesting-code-review/code-reviewer.md` and review the whole branch yourself; ledger `Final review: self-review`; Critical and Important findings get a failing test first; Minor go to the ledger.
- [ ] **Step 5: Record.** `CLAUDE.md`: a section "Link suggestions and unlinked mentions" placed before "Trash and soft-delete recovery" (another open branch edits the headings near "The assistant"): the decision and its cost, the three sources and two cards, the ambiguity rule, the measured floor (with the numbers, the overlap, and what the sample cannot show), what is written and where, undo through History, what is not done (rewriting the mention in place, suggestions for tasks or events, ranking by link graph, a "dismiss" that remembers, suggestions while typing in the editor). `README.md`: add to the Notes bullet. `ROADMAP.md`: tick item 7.
- [ ] **Step 6: Ship.** Commit, push `link-suggestions`, open a pull request against `main` (never a push to `main`) whose description lists what was verified and what was only read; report the checks once; do not poll CI.
