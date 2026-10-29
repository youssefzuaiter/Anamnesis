# Scoped assistant questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a question to the assistant search only one course, one project or one note, and prove that no other account's data, and nothing outside the scope, can enter the model's context.

**Architecture:** The scope is a `{ kind, id }` pair from the browser. A service checks, through a lookup scoped by the session's `userId`, that it is the caller's own live course, project or note, then lists the ids of everything that belongs to it (notes, tasks and events by `courseId` / `projectId`, plus the entity itself). Those ids narrow the vector search in SQL, before the top-k cut, as a second filter beside `userId`. Nothing is stored: membership is worked out at question time, so moving a note between courses takes effect at once and no re-index is needed.

**Tech Stack:** Next.js 16 route handler and server components, Prisma 7 raw SQL on pgvector, Zod, Tailwind (Quiet Studio tokens). No new dependency, no new model call, no migration.

**Spec:** ROADMAP item 6: "Restrict retrieval to one course, project or note. The evals must show another account's data still never enters the context." (Tagged *model*, not *demo*.) Decisions made while shaping it, binding on this plan:
- **A list of ids at question time, not a denormalized column.** The alternative was a `courseId`/`projectId` column on `WorkspaceEmbedding`: no big id lists, but a migration, a backfill, and a re-index every time anything moves between courses (a task, event or note re-assigned would otherwise be searchable under its old course until re-saved). Council run inline by me, so weaker than independent voices; the ids approach has no staleness and no migration, at the cost of an id list sized by the scope (a course with thousands of notes is still one array).
- **What a scope contains.** Course: the course row (its assessments and grades are in its embedded text), and its notes, tasks and events. Project: the project row, and its notes, tasks and events. Note: that note only. Goals, flashcards and wiki-linked notes are not included.
- **An unknown, deleted or another account's id is refused** (`RESOURCE_NOT_FOUND`), never answered as "nothing found", and before any embedding call.
- **The prompts do not change.** `SYSTEM_PROMPT` and the retrieval prompt are what the injection evals measured; changing them to mention a scope would move numbers nobody re-measured. The card says what is being searched instead.
- **Action requests ignore the scope** (they do not retrieve), but it is still validated so a bad id fails the same way for every question.

**Found while shaping, and part of this change:** the HNSW index that `CLAUDE.md` says sits under `WorkspaceEmbedding` does not exist. `20260913144800_embedding_hnsw_index` creates it and `20260913200054_focus_tracking_opt_in` drops it again (a Prisma-generated diff: Prisma cannot express pgvector index types). Checked in the dev database: only a primary key and two btrees. Search is therefore an exact scan, which is correct for a narrow scope. A restored HNSW index would apply its filter after picking its nearest candidates and could return nothing for a small scope; Task 2 adds a test that fails if that ever happens, and Task 5 corrects `CLAUDE.md`. The index is not restored here.

## Global Constraints

- No paid service, no new dependency, no migration (CLAUDE.md "Operations": none is needed).
- `lib/assistant-scope.ts` has no React and no Prisma import, so it is unit-testable.
- Every query is scoped by the session's `userId`, and a client-sent id is ownership-checked by a scoped lookup. The id lists are a second filter, never a replacement for the `userId` one.
- The scope is only ever one of `course`, `project`, `note`; the id is a UUID; the object is strict (a stray `userId` key is rejected).
- Prompts, `RELEVANCE_FLOOR`, `MAX_CHUNKS` and the injection defences are unchanged.
- The assistant dock stays unscoped in this change; the full `/ai` page gets the control.
- Copy is exact: label `Ask about`; first option `Everything`; groups `Courses`, `Projects`, and `This note`; sentences `Searching only this course: its notes, tasks, events and grades.`, `Searching only this project: its notes, tasks and events.`, `Searching only this note.`; links `Ask about this course`, `Ask about this project`, `Ask about this note`.
- Run heavy commands with `nice -n 19`. Playwright selects by label and by `main` (CLAUDE.md "Testing UI with Playwright").

## Review Focus

1. Another account's course, project or note id as the scope is refused, before any embedding, and the refusal is the same for an id that does not exist. (Tasks 2 and 3)
2. Whatever the question says, no chunk from another account and no chunk from outside the scope reaches the model's context, even when such a chunk is the closest match. (Tasks 2, 3 and 5)
3. A narrow scope still finds its own chunks when thousands of closer chunks sit outside it. (Task 2)
4. A note moved to another course, a deleted note, task or event, and an event with no course are put in or left out correctly at question time. (Task 2)
5. A scope id that is a valid UUID of the wrong kind (a note's id sent as a course) is refused, not matched. (Task 2)
6. A malformed scope in the request (bad kind, not a UUID, extra keys, an array) is a validation error, and a malformed `?scope=` in the URL is ignored. (Tasks 1 and 3)
7. Asking with a scope and then without one in the same thread works; changing the control closes nothing else. (Task 4)
8. On a phone the control fits, is at least 44px tall, and the page does not widen. (Task 4)

---

### Task 1: The scope, as a pure module

**Files:**
- Create: `src/lib/assistant-scope.ts`, `tests/unit/assistant-scope.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces, all exported from `src/lib/assistant-scope.ts`:
  - `SCOPE_KINDS = ["course", "project", "note"] as const` and `type ScopeKind`.
  - `type AssistantScope = { kind: ScopeKind; id: string }`.
  - `assistantScopeSchema`: `z.object({ kind: z.enum(SCOPE_KINDS), id: z.uuid() }).strict()`.
  - `parseScopeParam(value: string | string[] | undefined): AssistantScope | null`: accepts only a single string of exactly `kind:uuid` (lower-case kind, no spaces, nothing after the UUID); anything else, an array included, is `null`.
  - `formatScopeParam(scope: AssistantScope): string` (`course:<uuid>`); `scopeHref(scope: AssistantScope): string` (`/ai?scope=course:<uuid>`).
  - `scopeSentence(kind: ScopeKind): string`, the three sentences in Global Constraints.

- [ ] **Step 1: Write the failing tests** in `tests/unit/assistant-scope.test.ts` (node:test; `const ID = "5c9cfa77-4c99-4f6e-a64b-8466e70ba693"`):
  1. `parseScopeParam` accepts `course:ID`, `project:ID` and `note:ID` and returns `{ kind, id }`.
  2. It returns null for: `undefined`, `""`, `"course"`, `"course:"`, `"course:not-a-uuid"`, `"folder:" + ID`, `"Course:" + ID`, `"course:" + ID + ":x"`, `"course:" + ID + " "`, `" course:" + ID`, a 5,000-character string, and the array `["course:" + ID, "note:" + ID]`.
  3. `formatScopeParam` and `parseScopeParam` round-trip for all three kinds.
  4. `assistantScopeSchema` accepts a valid scope and rejects a bad kind, a non-UUID id, a missing key, and an extra key (`{ kind, id, userId }`).
  5. `scopeSentence` returns the three exact sentences.
  6. `scopeHref` is `/ai?scope=course:ID`.
- [ ] **Step 2: Run to confirm failure.** Run: `nice -n 19 pnpm exec tsx --conditions=react-server --test tests/unit/assistant-scope.test.ts` — Expected: FAIL, cannot find `@/lib/assistant-scope`.
- [ ] **Step 3: Implement** the module per the interfaces.
- [ ] **Step 4: Run to confirm pass,** then `nice -n 19 pnpm test` and `pnpm exec tsc --noEmit`. Mutation-check two rules, restoring after each: accept an array (take the first element), drop `.strict()`; each must fail a test.
- [ ] **Step 5: Commit** the plan, the module and the tests ("Add the assistant scope as a pure module").

---

### Task 2: Resolving a scope, and narrowing the search

**Files:**
- Create: `src/repositories/scope-repository.ts`, `src/services/scope-service.ts`
- Modify: `src/lib/vector.ts` (`searchWorkspaceVectors` gains an optional fifth parameter)
- Test: `tests/integration/scope.test.ts`

**Interfaces:**
- Consumes: Task 1; `searchWorkspaceVectors`; `AppError`.
- Produces:
  - `type SourceFilter = Partial<Record<EmbeddableSourceType, string[]>>` exported from `src/lib/vector.ts`; `searchWorkspaceVectors(userId, queryEmbedding, limit?, sourceTypes?, within?: SourceFilter)`. With `within`, a row is returned only if its `(sourceType, sourceId)` is listed, in the same query and before `LIMIT`, as `AND ("sourceType", "sourceId") IN (SELECT t, i FROM unnest(${types}::text[], ${ids}::text[]) AS s(t, i))` (two parallel parameter arrays, never string-built SQL), in addition to `"userId" = ${userId}`. An empty `within` (no ids at all) returns `[]` without querying. Without `within` the function behaves exactly as before.
  - `scope-repository.ts` (Prisma only, every query scoped by `userId`): `getScopeEntity(userId, scope): Promise<{ id: string; label: string } | null>` (a live course, labelled `CODE — Title`; a live project; a live note), and `listScopeMembers(userId, scope): Promise<{ notes: string[]; tasks: string[]; events: string[] }>` (for `course` and `project`: live notes and tasks, and events, whose `courseId` / `projectId` is the id; for `note`: all three empty).
  - `scope-service.ts`, `server-only`: `type ResolvedScope = { scope: AssistantScope; label: string; within: SourceFilter }` and `resolveScope(userId, scope): Promise<ResolvedScope>`: throws `AppError("RESOURCE_NOT_FOUND", "That course no longer exists.")` (`project`, `note` likewise) when `getScopeEntity` finds nothing; otherwise `within` holds the entity itself (`course` / `project` / `note` by its kind) and, for course and project, the member ids under `note`, `task` and `event`.

- [ ] **Step 1: Write the failing integration tests** in `tests/integration/scope.test.ts` (header and throwaway users like `tests/integration/exam-prep.test.ts`; vectors are built in the test: `const DIM = 768`, `unit(i)` a vector with 1 at index `i` and 0 elsewhere, `near(q, w)` a mix, inserted with `INSERT INTO "WorkspaceEmbedding" (...) VALUES (..., ${literal}::vector)` through `prisma.$executeRaw`; entities made directly with `prisma.*.create`):
  1. *a course scope holds the course and what belongs to it*: A has courses C1 and C2, notes (one in C1, one in C2, one with no course, one in C1 soft-deleted), tasks (one in C1, one soft-deleted in C1, one in C2) and events (one in C1, one in C2, one with no course). `resolveScope(A, course C1).within` is exactly `{ course: [C1], note: [the live C1 note], task: [the live C1 task], event: [the C1 event] }`, and `label` is `CMP2003 — Machine Learning`.
  2. *a project scope*: the same shape for a project; a note with both a course and a project is in both scopes.
  3. *a note scope* is `{ note: [that note] }`.
  4. *refused*: for each kind, another account's id, a random UUID, a soft-deleted entity, and (for note) a note of another account all throw `RESOURCE_NOT_FOUND`; so does a note's id sent as a `course` and a course's id sent as a `project`.
  5. *moving takes effect at once*: after `prisma.note.update` moves a note from C1 to C2, `resolveScope` shows it under C2 and not C1, with no re-index.
  6. *the filter narrows the search before the cut*: three chunks, one in scope but far from the query vector and two out of scope but nearer; `searchWorkspaceVectors(A, q, 1, undefined, within)` returns the in-scope chunk; without `within` it returns the nearer one.
  7. *another account is never returned*: B has the chunk nearest to the query; A's search with a `within` that lists B's note id still returns nothing of B's (the `userId` filter holds), and A's scoped search of its own scope never includes it.
  8. *an empty allowed list returns nothing and makes no query*: `within = {}` and `within = { note: [] }` give `[]`.
  9. *a narrow scope among many*: 600 filler chunks (distinct sources, all near the query) and 3 in-scope chunks far from it; the scoped search with limit 8 returns the 3 in-scope chunks and nothing else; the same search without `within` returns none of them. (This is the test that would fail if an approximate index that filters after its candidates were ever added.)
  10. *without `within` the search is unchanged*: the result for a fixed set of chunks equals what it was (ordering by similarity, `userId` scoped).
- [ ] **Step 2: Run to confirm failure.** Run: `nice -n 19 pnpm exec tsx --conditions=react-server --env-file=.env --test tests/integration/scope.test.ts` — Expected: FAIL, cannot find `@/services/scope-service`.
- [ ] **Step 3: Implement** the repository, the service and the `within` filter.
- [ ] **Step 4: Run to confirm pass.** The Step 2 command, then `nice -n 19 pnpm test:integration`, `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`. Mutation-check four rules, restoring after each: drop `userId` from `getScopeEntity`; drop `deletedAt: null` from the notes member query; ignore `within` in the search; drop the `userId` filter in the search (the cross-account test must fail); each must fail a test.
- [ ] **Step 5: Commit** ("Narrow the assistant's search to a course, project or note").

---

### Task 3: Wiring the scope into the assistant and its route

**Files:**
- Modify: `src/services/assistant-service.ts`, `src/app/api/ai/chat/route.ts`
- Test: `tests/integration/scope.test.ts` (extend), `tests/e2e/assistant-scope.spec.ts` (new, the API part)

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - `retrieveContext(userId, question, history = [], scope?: AssistantScope | null)`: with a scope, resolves it first (before `embedQuery`) and passes `within` to `searchWorkspaceVectors`; without one it is exactly as before.
  - `answerQuestion(userId, question, history = [], signal?, scope?: AssistantScope | null)`: resolves the scope as its first step (so a bad id fails for action requests too), then as before.
  - The chat route's body schema gains `scope: assistantScopeSchema.nullish()`; a malformed scope is the existing 400 `VALIDATION_ERROR`; a valid shape that does not resolve arrives as the stream's `error` frame with code `RESOURCE_NOT_FOUND`.

- [ ] **Step 1: Write the failing tests.** In `tests/integration/scope.test.ts`: *a scope that does not resolve fails before the model is touched*: with Ollama off, `answerQuestion(A, "what is in my notes?", [], undefined, { kind: "course", id: B's course })` rejects with `RESOURCE_NOT_FOUND` on its first step (consume the generator), and so does `retrieveContext(A, "anything", [], { kind: "note", id: randomUUID() })`; with a valid own scope and Ollama off the failure is the embedding one, not a not-found. In `tests/e2e/assistant-scope.spec.ts` (API, `page.request`): a POST with a malformed scope (`{ kind: "folder", id: "x" }`, a scope with an extra `userId` key, an array) is a 400 `VALIDATION_ERROR`; a POST with a well-formed scope for an id that does not exist is a 200 stream whose frames include `{ type: "error", error: { code: "RESOURCE_NOT_FOUND" } }`; both without needing Ollama.
- [ ] **Step 2: Run to confirm failure** (`nice -n 19 pnpm exec tsx ... scope.test.ts`, and `playwright test tests/e2e/assistant-scope.spec.ts`) — Expected: FAIL.
- [ ] **Step 3: Implement** the signature changes and the route schema.
- [ ] **Step 4: Run to confirm pass,** then `nice -n 19 pnpm test:integration`, `tsc`, `lint`. Mutation-check: resolve the scope after `embedQuery` instead of before (the Ollama-off test must fail); skip validation of the scope in `answerQuestion` for action requests (the not-found test for an action-shaped question must fail; add that question to the test).
- [ ] **Step 5: Commit** ("Let a chat question carry a scope").

---

### Task 4: The control, the links, and the browser tests

**Files:**
- Create: `src/components/scope-picker.tsx`
- Modify: `src/components/assistant-chat.tsx`, `src/app/(dashboard)/ai/page.tsx`, `src/app/(dashboard)/courses/[id]/page.tsx`, the project page and the note page (read each first), `tests/e2e/assistant-scope.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3; `listCourseOptions`, `listProjectOptions`; `scopeSentence`, `formatScopeParam`, `scopeHref`, `parseScopeParam`.
- Produces:
  - `ScopePicker(props: { value: AssistantScope | null; courses: { id: string; label: string }[]; projects: { id: string; label: string }[]; note: { id: string; label: string } | null; onChange: (scope: AssistantScope | null) => void })` (`"use client"`): a labelled native `<select>` (`Ask about`, min height 44px) with `Everything`, an optgroup `Courses`, an optgroup `Projects`, and (only when `note` is given) an optgroup `This note`; below it, the sentence from `scopeSentence` while a scope is chosen. Option values are `formatScopeParam`.
  - `AssistantChat` takes optional `scopeChoices?: { courses; projects; note }` and `initialScope?: AssistantScope | null`; with `scopeChoices` it shows the picker above the input and sends `scope` in the request body (`null` for Everything); the placeholder becomes `Ask about {label}…` while scoped. Without `scopeChoices` (the dock) nothing changes.
  - `/ai` reads `?scope=` through `parseScopeParam`, loads options (`listCourseOptions`, `listProjectOptions`), and for a `note` scope loads that note's title through a `userId`-scoped lookup; a scope that is not the caller's own, or a malformed one, is ignored (Everything).
  - Links `Ask about this course`, `Ask about this project` and `Ask about this note` (to `scopeHref`) on the course, project and note pages.

- [ ] **Step 1: Write the failing e2e tests** (extend `tests/e2e/assistant-scope.spec.ts`; make a course through the Courses form as `workspace.spec.ts` does):
  1. *the control and the sentence*: `/ai` shows `Ask about` with `Everything` selected and no sentence; choosing the course shows `Searching only this course: its notes, tasks, events and grades.` and the placeholder `Ask about CMP…`; choosing `Everything` removes both.
  2. *the request carries the scope*: with the course chosen, asking (`page.waitForRequest("**/api/ai/chat")`) sends a body whose `scope` is `{ kind: "course", id }`; the next question with `Everything` sends `scope: null`. (The answer is not asserted: it needs the model.)
  3. *a link preselects*: from the course page, `Ask about this course` opens `/ai?scope=course:<id>` with that course selected; the same for a project and for a note (`This note` group shown, its title as the option).
  4. *a bad scope in the URL is ignored*: `/ai?scope=course:not-a-uuid` and `/ai?scope=course:<random uuid>` show `Everything` selected and no error.
  5. *the dock is unchanged*: the docked assistant (Ctrl+J) shows no `Ask about` control.
  6. *phone*: at 375px the `/ai` page has no horizontal overflow and the select is at least 44px tall.
- [ ] **Step 2: Run to confirm failure.** Run: `nice -n 19 pnpm exec playwright test tests/e2e/assistant-scope.spec.ts` (the dev server on port 3100 must be running) — Expected: FAIL.
- [ ] **Step 3: Implement** the picker, the chat changes, the page and the three links, in the style of `template-picker.tsx` and `plan-day.tsx`.
- [ ] **Step 4: Run to confirm pass,** then `nice -n 19 pnpm test:e2e` — Expected: every test passes, including the existing assistant tests (the selector `getByLabel("Ask your workspace")` must stay unique on `/ai`: the new select is labelled `Ask about`, which does not contain that text).
- [ ] **Step 5: Commit** ("Add the Ask about control to the assistant page").

---

### Task 5: The evals, the guard, the checks, the record, the ship

**Files:**
- Modify: `tests/ai/evals.ts`, `CLAUDE.md`, `README.md`, `ROADMAP.md`

- [ ] **Step 1: The evals.** In `tests/ai/evals.ts`, after "Assistant retrieval and citations", a section "Scoped questions": an owner with two courses and an uncoursed note about the same topic, and an intruder account whose note about that topic is the closest match to the question and carries a unique marker. Checks: unscoped retrieval cites notes from both courses and the uncoursed one and nothing from the intruder; scoped to course A every citation is in A's set, the context text holds A's marker and neither B's nor the intruder's; scoped to B likewise; scoped to a note, only that note; the intruder's course id as the scope, and a random UUID, raise `RESOURCE_NOT_FOUND` through `expectAppError`; a question that quotes the intruder's marker verbatim, asked with a scope, still has no intruder text in the context; an empty course gives no citations and the "No workspace excerpts matched" block; `answerQuestion` with a scope emits citations that are all in scope (consume only the first event). Run it: start Ollama (`nice -n 19 ollama serve`), pull nothing new, run a copy of `evals.ts` cut down to the header, the scoped section and the footer (the full suite also calls the chat model for many minutes; CI runs it whole). Mutation-check: ignore `within` in `retrieveContext`; the section must fail.
- [ ] **Step 2: Guard.** Run the `security-review` skill over the diff. What to check: the scope id is ownership-checked by a lookup scoped by `userId` before any embedding; the id lists come from `userId`-scoped queries and the search keeps its own `userId` filter; no SQL is built from strings (parameter arrays only); the route validates the scope strictly; errors are static; the `?scope=` and note title lookups are scoped. Ledger what it found and correct anything assumed rather than read.
- [ ] **Step 3: Simplify.** Run the `simplify` skill over `git diff <BASE>..HEAD -- src tests`; behaviour-preserving only.
- [ ] **Step 4: Check.** `nice -n 19` for each: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e`. Then look at `/ai` on a throwaway account (`e2e` prefix, deleted afterwards): desktop and 375px, light and dark: the control, the sentence, a course scope chosen, the links from a course, project and note page. Ask a scoped question with Ollama running if the chat model is present; say so if it is not.
- [ ] **Step 5: Review.** Read `requesting-code-review/code-reviewer.md` and review the whole branch yourself; ledger `Final review: self-review`; Critical and Important findings get a failing test first; Minor go to the ledger.
- [ ] **Step 6: Record.** `CLAUDE.md`: a section "Scoped assistant questions" after "Exam prep planner": the decision and its cost, what a scope contains, what is refused and when, why the prompts did not change, why an id list and not a column, the action-request rule, what is not done (the dock, scoping a saved thread, goals and flashcards, a scope on a proposal). **Correct the "Stack decisions" paragraph that says an HNSW index exists:** say that the migration creates it and the next one drops it, that search is an exact scan, why that is fine at this size, and that restoring an approximate index needs the scoped-search test to keep passing. `README.md`: add a bullet. `ROADMAP.md`: tick item 6.
- [ ] **Step 7: Ship.** Commit, push `scope-questions`, open a pull request against `main` (never a push to `main`) whose description lists what was verified and what was only read; report the checks once; do not poll CI.
