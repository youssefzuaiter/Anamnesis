@AGENTS.md

# Nexus OS — Master Engineering Specification

AI-native personal knowledge and productivity operating system, built for its
author — an AI Engineering student — as a single-tenant, self-hosted workspace.

**Core product principle: everything is connected.** Notes, tasks, calendar events,
projects, and knowledge form one interconnected workspace the AI understands, while
respecting strict security, privacy, and architectural boundaries.

## Execution strategy

Build strictly step-by-step. Do not generate the entire codebase in one response.
Inspect the repository, identify architectural implications, propose the affected
files/data models/interfaces, and only then implement.

## Non-negotiable engineering rules

- Complete, production-ready TypeScript. **Zero stubs, zero fake implementations,
  zero mock databases, zero TODO placeholders.**
- Every implemented file must be fully functional. Never silently omit required
  functionality or substitute fake data for an unavailable integration.
- Business logic stays separate from presentation logic.
- Standard request flow:
  `UI → Server Action / API → Validation (Zod) → Authorization → Service / Use Case → Repository`
- No overengineering. Stick to Next.js, PostgreSQL, Prisma, and pgvector. No
  premature microservice extraction or distributed infrastructure.

## API contracts

```ts
type ApiResponse<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: { code: string; message: string } };
```

Error codes: `AUTH_REQUIRED`, `FORBIDDEN`, `RESOURCE_NOT_FOUND`, `VALIDATION_ERROR`,
`RATE_LIMITED`, `AI_UNAVAILABLE`, `AI_OUTPUT_INVALID`, `VECTOR_SEARCH_FAILED`,
`INTEGRATION_ERROR`.

## Security, threat modeling & guardrails

1. **Multi-tenant isolation.** Every query must explicitly filter by a `userId`
   derived from the server-side session. Never trust a client-provided user ID.
2. **Prompt injection defense.** Retrieved RAG chunks and user-uploaded text are
   untrusted data. Instructions inside retrieved notes/documents must never
   override system instructions or authorization policies.
3. **AI permissions model.** The agent operates via a strict permission boundary
   (`READ_NOTES`, `READ_TASKS`, `CREATE_TASK`, `CREATE_EVENT`, …) mediated entirely
   by server-side Zod validation and user ownership checks.
4. **Idempotency.** Mutations triggered by background jobs, webhooks, or AI tool
   calls must carry idempotency keys or transaction state checks.
5. **Human-in-the-loop.** High-consequence AI actions (multi-task creation,
   schedule overriding) emit a Proposed Action payload requiring explicit user
   confirmation, audited via `AuditEvent`.

## Stack decisions

Chosen to keep the project free to run — no paid API keys.

| Concern | Choice | Notes |
| --- | --- | --- |
| Database | Postgres 17 + pgvector 0.8.6 in Docker | `docker-compose.yml`, host port **5434** (5433 is taken by an unrelated local Postgres container) |
| ORM | Prisma 7 | Datasource URL lives in `prisma.config.ts`, **not** the schema. Client uses the `@prisma/adapter-pg` driver adapter and generates to `src/generated/prisma` |
| Embeddings | Ollama `nomic-embed-text` | **768 dimensions**, not the 1536 the original spec assumed. Requires task prefixes — see below |
| Chat / tool calling | Ollama `llama3.2:3b` | Swap via `OLLAMA_CHAT_MODEL` |
| Auth | NextAuth v5 (Auth.js) beta, Credentials + JWT | `trustHost: true`; route guards live in layouts, not middleware |
| Password hashing | `node:crypto` scrypt | No native build step and no extra dependency; format is `scrypt$N$r$p$salt$hash` |
| Dev port | **3100** (pinned in `package.json`) | Port 3000 is occupied by an unrelated local app on this machine |

Changing the embedding model to one with different output dimensions requires a
new migration — `EMBEDDING_DIMENSIONS` in `src/lib/config.ts` is pinned to the
`vector(768)` column for that reason.

The pgvector ANN index is HNSW with `vector_cosine_ops`, declared in a hand-written
migration because Prisma cannot express pgvector index types. Similarity queries use
`1 - (embedding <=> $vector)`.

**Always embed through `embedQuery()` or `embedDocuments()`, never `embedTexts()`
directly.** `nomic-embed-text` is trained with asymmetric task prefixes
(`search_query:` / `search_document:`); omitting them is silent — no error, just
worse ranking. In the eval suite it was the difference between precision@1 of 0.80
and 1.00. `applyTaskPrefix` in `lib/ollama.ts` is a no-op for models that do not
follow this convention, so swapping `OLLAMA_EMBEDDING_MODEL` stays safe.

Pure text logic lives in `lib/chunking.ts` rather than `lib/vector.ts` so it can be
imported without pulling in Prisma and the fail-fast env validation.

## Entity modules

Notes are the reference implementation of the layered flow. Follow the same shape
for tasks, events, and projects:

- **Repository** (`repositories/note-repository.ts`) — Prisma only, every query
  scoped by `userId`. Mutations use `updateMany`/`deleteMany` with the `userId` in
  the `where`, so ownership is part of the write itself; `update()` matches on id
  alone and would need a separate ownership read.
- **Service** (`services/note-service.ts`) — business rules plus vector-index
  upkeep. Throws `AppError`, never returns an `ApiResponse`.
- **Action** (`actions/notes.ts`) — `requireUserId()`, Zod parse, call the service,
  `revalidatePath`, return `ApiResponse`. `redirect()` must sit *outside* any
  try/catch, since it signals by throwing.

**Index upkeep is a service concern, not a UI one.** Creating or updating an entity
re-indexes it; soft-deleting removes its embeddings immediately, so the assistant
can never cite content the user believes is deleted. If indexing fails, the save
still succeeds and the stale rows are dropped: the entity goes missing from
semantic search until it is saved again, which is recoverable in a way that citing
superseded text is not.

Semantic search degrades to a SQL `contains` match when Ollama is unreachable, and
the UI says which mode produced the results — never silently pretend keyword hits
are semantic ones.

**Embed entities as natural prose, never key-value lines.** Measured against
nomic-embed-text, `"ML midterm. This is a calendar event on Tuesday, 15 September
2026, from 09:00 to 11:00, taking place at Hall C."` beats `"ML midterm\nWhen: …\n
Where: …"` on every real question tried — "where is my exam being held" went from
0.52 (below the relevance floor, so the assistant could not see it at all) to 0.56,
and queries that already matched improved too. Phrase new entity types the same way.

**Events are hard deleted** — `Event` is the one entity with no `deletedAt` column
in the spec's schema. Notes, tasks, projects and goals are soft deleted.

**A multi-day event appears in every day cell it spans**, so anything counting
events across a grid must count distinct ids, not cell occurrences.

**Shared domain constants live in `lib/domain.ts`, never in a repository.**
Repositories are `server-only` and import Prisma, so a client component importing
a *value* from one (`PROJECT_CATEGORIES` for a `<select>`) pulls the database layer
into the browser bundle and fails the production build. Type-only imports are
erased and safe; values are not. `next dev` does not catch this — `pnpm build`
does, which is why the build must be run before calling a step finished.

**A client-supplied `projectId` must be ownership-checked.** The database will
happily accept another user's project id, silently attaching one tenant's note to
another's project. `assertProjectOwned()` guards every note, task and event
mutation, and the evals verify all three.

**Deleting a project detaches its contents rather than cascading.** Losing a
project must never silently take the user's notes, tasks and events with it.

**Backlinks use `[[Note title]]` and resolve by title, within one account.**
`EntityLink` rows are written only for links that resolve; unresolved ones are
re-derived from the content at render time and offered as "not yet written".
Creating or renaming a note re-resolves everyone who mentions its title, so a
link written before its target existed fills itself in — without that, links
would stay broken until each referrer was edited by hand. Deleting a note clears
its links in both directions.

**`/notes/graph` renders a force-directed layout with no physics library.** A
personal note graph is small — tens to a few hundred nodes — so
`components/note-graph.tsx` runs a plain O(n²) repulsion + spring simulation
for a fixed 300 iterations to a resting position, once, rather than animating
every frame or pulling in d3-force. Dragging a node afterward is direct
position assignment, not re-simulation — only the dragged node needs to move.
Mutual links between two notes produce two directional `EntityLink` rows, so a
pair that links both ways draws as one visual edge but counts as two in the
link total shown in the header, matching what `listGraph` in
`link-repository.ts` actually returns; that count is deliberately literal
rather than deduplicated, since it's the same directional-edge model backlinks
already use.

**`/notes/import` turns a PDF into a plain Note rather than a new entity
type.** There is no `Document` model, no new `sourceType`, no new citation
case in the assistant — `importPdfAction` extracts text with `pdf-parse`
(`lib/pdf.ts`) and calls the exact same `noteService.createNote` every other
note goes through, tagged `imported`. That single decision is why the feature
is small: indexing, chunking, semantic search, RAG citations, backlinks and
the command palette all already work on notes, so an imported syllabus is
searchable and citable by the assistant with no changes to any of those
paths — confirmed by checking `WorkspaceEmbedding` after an import rather
than assumed. `lib/pdf.ts` splits the pure text validation/truncation
(`normalizeExtractedText`) from the actual parsing (`extractPdfText`) so the
empty-text rejection and the truncation marker are unit-testable without a
real PDF fixture — a scanned, image-only PDF extracts to nothing and is
refused rather than silently saved as an empty note. `next.config.ts` raises `experimental.serverActions.bodySizeLimit` to 15mb
(the default is far too small for a PDF upload) and marks `pdf-parse` as a
`serverExternalPackage` so it reads its own runtime assets instead of being
bundled — both added before the first real upload was driven through the
browser, rather than added reactively after a failure, since bundling a
pdfjs-dist-based package is a known enough footgun in Next.js to anticipate.

**Capture parsing splits the work by competence.** Dates and times are resolved
by `lib/natural-date.ts` in pure code, never by the model — a 3B model will
confidently give the wrong calendar date for "next Friday". The model only
classifies task/event/note and picks out priority, location and duration, under a
JSON schema Ollama enforces at decode time and Zod re-checks afterwards, because
schema conformance is not correctness.

**The title is the user's own words, not the model's.** Asked explicitly to keep
the wording, llama3.2:3b still summarises — "coffee with Ada at Starbucks" came
back as "Coffee Meeting", losing both the person and the place. Stripping the
matched date phrases from the original text beats it, so the model's title is
only a fallback for when stripping leaves nothing.

**Voice input fills the same text box a typed capture would, and nothing
more.** `components/quick-capture.tsx`'s mic button transcribes through the
browser's own `SpeechRecognition` — free, on-device wiring with no server
route or API key — and calls `setText()` with the result, so the transcript
lands in the exact same input, subject to the exact same "review before it's
sent" step, as anything typed by hand. There is no separate voice-to-proposal
path to keep in sync with the typed one. TypeScript's DOM lib does not
include Web Speech API types, so the component declares the minimal shape it
actually uses rather than pulling in a types package for one interface.
Support is checked lazily inside the click handler, not during render or in
an effect that calls `setState` — checking during render would mean the
server (no `window`) and the post-hydration client render different DOM for
the same component, and an unsupported browser simply gets a clear error
message on click rather than the button being conditionally rendered at all.

**`/api/ai/parse` returns a proposal and writes nothing.** The user confirms
before anything is created, and `confirmCaptureAction` re-validates the whole
proposal from scratch: by the time it comes back it has passed through the
browser, so it is client input regardless of what produced it. This is the shape
tool calling must follow when it lands.

**The command palette (⌘K / Ctrl+K) searches literally, not semantically.**
It runs on every keystroke, so an embedding round trip per keypress would be
slow and wasteful; `quickSearch` is a debounced substring query across all four
entity types. Semantic search stays on the notes page and in the assistant.

**React 19 rejects synchronous `setState` inside an effect body.** Resetting
selection or clearing stale results belongs in the input's change handler, and
state that merely derives from other state (the clamped active index) should be
computed during render. `pnpm lint` catches this; `tsc` does not.

**The dashboard reads, never writes.** `services/dashboard-service.ts` assembles
Today, Schedule, Recent notes and Active projects from the existing repositories
in one parallel fetch. "Next up" is deliberately suppressed while today still has
an unfinished event, so the panel never repeats what the schedule already shows.

**Time blocks are separate from due dates.** `Task.dueDate` is when something is
owed; `scheduledStart`/`scheduledEnd` are when you plan to do it. A block given
only a start runs for `estimatedMinutes`, an end without a start is discarded
rather than stored, and blocks render on the calendar and dashboard as dashed
outlines so a plan to work is never mistaken for an appointment.

**Dragging a task onto the calendar reuses `updateTask`, not a partial
patch.** `updateTask` replaces the whole `Task` row — there is no `PATCH`-style
partial update in this codebase — so `scheduleTask()` in `task-service.ts`
reads the existing row first and carries every field forward, changing only
`scheduledStart`/`scheduledEnd`. Skipping that read and sending just the two
schedule fields would silently null out the title, priority and everything
else on drop. The drop always lands at 09:00 local on the target day with the
usual `estimatedMinutes` duration — precise time-of-day dragging would need
an hourly grid the calendar doesn't have, so the existing task detail page is
still where you fine-tune the exact time.

`scheduleTaskAction` is called directly from the client drag handler
(`components/calendar-dnd.tsx`), not through a `<form>` — so unlike every
other mutation in this codebase, nothing automatically tells the
already-rendered page to catch up. The handler calls `router.refresh()`
itself after the action resolves, which no other action in this app needs to
do. `repositories/task-repository.ts`'s `listUnscheduled()` (open tasks with
no `scheduledStart`) feeds the draggable tray;
`components/unscheduled-tasks.tsx` and `calendar-dnd.tsx` share one MIME
string (`TASK_DRAG_MIME` in `lib/domain.ts`) as the drag payload key so a
typo in one can't silently desync from the other.

**Recurrence is materialized once, not a stored rule.** "Repeat weekly, 6
times" creates 6 real `Task`/`Event` rows sharing a `recurrenceId` at request
time — there is no `RecurrenceRule` model and no background job generating
future occurrences. This was a deliberate trade against the alternative
(store a rule, expand it virtually at read time): virtual expansion would
have touched every read path that queries these tables directly — both
calendar grid builders, the dashboard, task buckets, the command palette,
vector indexing, the assistant's tool proposals — since none of them know how
to expand a rule. Materializing means every one of those paths needed zero
changes, at the cost of a fixed horizon (`MAX_RECURRENCE_COUNT` = 52 in
`lib/recurrence.ts`) rather than an open-ended series. `generateOccurrences()`
clamps a monthly step to the last real day of a short month (Jan 31 → Feb 28,
not an overflow into March) since `Date.setMonth` on the 31st of a 30-day
target rolls forward otherwise.

Recurrence is offered only on the create form, never on edit — editing one
occurrence never turns it into, or updates, a series. "Delete this and future
occurrences" (`deleteEventSeriesFrom` / `deleteTaskSeriesFrom`) removes this
row and every later one sharing its `recurrenceId`, keeping earlier ones as
history, and loops the existing single-delete path per row rather than a raw
batch query — series are capped at 52, so the N round trips are cheap, and it
reuses embedding cleanup and progress recalculation instead of duplicating
them. A task needs a due date to anchor a series on; one with no due date is
refused with `VALIDATION_ERROR` rather than silently repeating from nothing.

**Derived fields are set in one place.** Project `progress` is computed from
linked tasks and written only by `recalculateProgress()`, which every task
mutation calls — including moving a task between projects, which changes both. `completedAt` is written only by
`setTaskStatus`, from the status, so the two cannot drift apart. Do not expose it
as an independently editable field. Goal `progress` follows the same rule, one
level up — see "Goals" below.

**Dates entered as `yyyy-mm-dd` are pinned to local end-of-day** before storage. A
bare date string parses as UTC midnight, which lands on the *previous* day for
anyone behind UTC, silently making today's tasks look overdue. Task buckets are
whole-day too: a task due at 09:00 is still "today" at 18:00, never overdue.

**Calendar month/week/day views share one `CalendarDay[]` shape and one range
fetcher.** `buildMonthGrid`, `buildWeekGrid` and `buildDayGrid` in
`event-service.ts` all call the same `fetchRangeData` + `buildDays` pair with a
different start date and day count, so the multi-day-event and time-block
filtering logic exists exactly once. Switching view tabs preserves your place
rather than jumping to today: the reference date carries over (month's is the
1st of the month, week's is that week's Monday), so `?view=week` from September
shows the week containing September 1st, not the current week. Day view skips
the per-cell item cap (month: 5–6, week: same) and renders a flat chronological
agenda instead — a day has room for the full list.

## Trash and soft-delete recovery

`/trash` lists the soft-deletable entities — `TRASH_KINDS` in
`lib/domain.ts` is `["note", "task", "project", "goal"]`. `Event` never appears there
because it is hard-deleted (see "Events are hard deleted" above). That constant
was moved out of `actions/trash.ts` and into `lib/domain.ts` because a
`"use server"` module may only export async functions; exporting a plain array
from one made every restore and purge fail at runtime.

`TrashRow`'s restore/purge buttons are plain click handlers, not a `<form>`, so
— the same reason `calendar-dnd.tsx` and `scheduleTaskAction` need it —
`revalidatePath` alone leaves the row showing in an already-rendered list after
it leaves the trash; the component calls `router.refresh()` itself once the
action resolves.

**Restoring a project or a goal recomputes its `progress`.** Deleting detaches
everything the entity held — it nulls `projectId`/`goalId` on its tasks — but
leaves the stored percentage as it was. A restore that only cleared
`deletedAt` therefore brought back a goal deleted at 100% still reading 100%
for work that was no longer attached to it, and a project deleted at 67% still
reading 67% of nothing. Both restores now call the same recalculation every
task mutation does, which also re-syncs the search index (the embedded text
contains the percentage) and, for a project, cascades to its goal. The goal
version was caught by writing the goals Playwright test, which deletes a goal
at 100% and checks it after restoring; the project version is the same bug,
fixed alongside it.

## Day planning

The dashboard's "Plan my day" button (`components/plan-day.tsx`) is pure
arithmetic, not a model call — `lib/day-planner.ts` has no Prisma import and no
LLM in its path, the same split the capture parser makes for dates: which task
matters most is a sort, and where it fits is subtraction, and a 3B model is not
better at either.

`freeIntervals()` computes the day's open gaps between 09:00 and 21:00
(`DAY_START_HOUR`/`DAY_END_HOUR`), given real events and already-scheduled
blocks as "busy". Only the lower bound is clamped to `now`: an earlier version
also compared `now < dayEnd`, which meant that once the day was over the clamp
fell back to `dayStart` and happily proposed slotting a task into that
morning's already-past 09:00 slot at 11pm. `planDay()` then places tasks
highest-priority first, then soonest due, then shortest, so a day that cannot
fit everything still fills with what matters most; a task is never split
across gaps or shortened to fit — a 90-minute task waits for a day with room
rather than becoming a 30-minute one. Each placed block gets a 10-minute gap
after it, so a plan is not a wall of back-to-back work.

`proposePlanAction` only computes and returns a plan, exactly like
`/api/ai/parse` — nothing is written until the user confirms. `applyPlanAction`
then re-derives the plan from scratch and only schedules the subset of task ids
the browser sent back, rather than trusting the times it was given, since a
plan that went through the browser is client input regardless of what produced
it (the same rule action-service.ts and capture confirmation follow).

## Course grades

`lib/grades.ts` is pure arithmetic over a course's `Assessment` rows — no
Prisma, no model, so "what do I need on the final" is checkable rather than
trusted. `summarise()` reports `earned`, `gradedWeight`/`remainingWeight`,
`currentAverage` (null until anything is graded), `bestPossible` (everything
remaining scored perfectly), and `declaredWeight`, which need not add up to
100. Only the floor of a score-to-max ratio is clamped, not the ceiling —
bonus marks above the stated max are real and should count.

`neededForTarget()` returns one of three shapes rather than a single number,
because "you need 104%" and "you already have it" are answers a plain
percentage would blur: `achieved` (already there), `impossible` (even a
perfect score on everything left falls short, by how much), or `needed` (the
average still required on what's ungraded).

Every derived figure shown in `GradePanel` — the average, what's still needed,
the whole row above the input — is computed server-side from the scores, so
each mutation (`setAssessmentScoreAction`, add, delete) is followed by
`router.refresh()`; without it the panel kept showing the pre-edit numbers
until some unrelated navigation forced a re-render.

**Courses are part of the semantic index — they were not until now.**
`"course"` was missing from `EMBEDDABLE_SOURCE_TYPES` entirely, so despite
"everything is connected" being the whole point of this app, asking the
assistant "what's my grade in CMP2003" or "when's my next exam" failed even
though the answer lived one page away, because the RAG index simply never
saw a `Course` or `Assessment` row. Fixed the same way `/notes/import` was
kept small: reuse the existing entity-to-prose/index/citation machinery
rather than inventing a parallel path for a fifth type.

A course is indexed as **one** embedding covering the course plus a rundown
of its assessments — `embeddableTextFor.course()` +
`courseAssessmentSummary()` in `embeddable-text.ts` — the same shape a
project's embedded text folds in a task rundown rather than indexing each
task separately. `courseAssessmentSummary` calls `summarise()` from
`lib/grades.ts` rather than restating the percentage arithmetic, so the
assistant's answer and the grade panel's own numbers can never disagree.
Verified end to end against the real DB and Ollama (not asserted from
reading the code): a course with a graded midterm and an ungraded final
retrieved at 0.72 similarity for "what is my current grade", 0.65 for
"when is my next exam" — both comfortably above the 0.55 `RELEVANCE_FLOOR` —
with the embedded prose correctly reporting a 78% current average and a 63%
best-possible mark.

`indexCourse()` lives in `course-service.ts`, following `syncNoteIndex`'s
shape, and is called from `actions/courses.ts` after every mutation that
changes what a course's prose says: creating the course, and creating,
scoring or deleting an assessment (not editing a course's own fields — there
is no edit-course action in this app to call it from). Adding or scoring an
assessment re-indexes the *course*, not a new "assessment" entity, since the
assessment doesn't have its own citable page. Deleting or scoring an
assessment only had an id to work with, so `updateAssessment` and
`deleteAssessment` in `course-repository.ts` now return the affected row
instead of a bare boolean — the same reason `deleteAttachmentRow` returns a
row — purely so the caller has the `courseId` to re-index without a second
read. Soft-deleting a course calls `deleteEntityEmbeddings` directly from the
action, since courses have no service-layer delete function of their own.

Widening `EmbeddableSourceType` to include `"course"` is one array entry in
`lib/vector.ts`, but `SearchHit["kind"]` in `search-repository.ts` is shared
between that (the semantic `/search` page and `RelatedItems`, which now
surface courses) and the command palette's literal `quickSearch`, which
deliberately still does **not** search courses — so `Record<Command["kind"],
string>` in `command-palette.tsx` needed a `course` entry to stay exhaustive
even though quickSearch itself never produces one. `/search`'s type-filter
chips are generated from `EMBEDDABLE_SOURCE_TYPES.map(...)`, so a "courses"
chip appeared there for free.

**`/courses/[id]` opens with an exam-prep summary strip**, folded into the
existing page rather than a new route — the course hub already showed the
raw ingredients (assessments, notes, tasks) but never the one thing worth
seeing first: how worried to be about this course right now. `nextUngraded()`
in `lib/grades.ts` picks the soonest assessment that is both undated-in-the-
past and unscored — an assessment already graded is never proposed as
something to study for even if its due date happens to sit in the future.
`daysUntilLabel()` compares calendar dates, not exact timestamps, the same
whole-day convention task buckets already use: a final due at 23:59 today
reads "today" all day, not "in 1 day" just because it's currently 2pm.
`flashcard-repository.ts`'s `countDueForCourse` joins through `Note` — a
`Flashcard` has no `courseId` of its own, only an optional `noteId`.
Verified against a real logged-in session rather than assumed from the
component tree: a course with a graded midterm, an unscored final due in
three days, and two due flashcards rendered "Final in 3 days · current
average 78% · best possible 63% · 2 flashcards due" in the actual server
response.

## Goals

A goal is a semester- or career-length objective that projects and tasks roll
up into — the pattern a project already runs over its tasks, one level up. It
follows the same repository → service → action shape as every other entity and
is soft-deleted like notes, tasks and projects (events are the one hard-deleted
entity, for a reason that does not apply here). Its category reuses
`PROJECT_CATEGORIES` rather than adding a second, near-identical enum.

**`goalId` is an independent link on both `Project` and `Task`, not a
hierarchy.** A task can count toward a goal directly — a "read twelve books"
goal needs no project — or through a project that is itself linked to the goal,
or both. That is the same non-exclusive precedent `Task` already sets between
its own `projectId` and `courseId`. A task reached by both paths is still one
row in the rollup query, so it is never counted twice.

**Progress is a raw task count, not an average of percentages.**
`recalculateGoalProgress` — the only writer of `Goal.progress` — takes every
live task that is linked directly *or* sits under a live linked project and
stores `done / total`. Averaging each project's own percentage would let a
one-task project weigh as much as a forty-task one. `getGoalTaskTotals` runs
the same query read-only, so the goal page can show the fraction its
percentage was computed from. An earlier header read "67% … 1/1 direct tasks",
because it counted direct tasks only; that was found by clicking through the
running app, not by any type check.

**The cascade reuses a call every task mutation already makes.**
`recalculateProgress` in `project-service.ts` runs after every task mutation
and now ends by recalculating its project's goal, so "task under a project
under a goal" needed no change in `task-service.ts`. Only a task's *direct*
`goalId` is handled there, with the same before/after treatment `projectId`
gets: create, update (old goal and new), status change, delete and restore.
Moving a project between goals does the same in `updateProject`.

**`goalId` is required on `TaskInput` and `ProjectInput` on purpose.**
`updateTask` replaces the whole row — this codebase has no partial update — so
an optional `goalId` would let a caller that merely forgot it silently unlink a
task from its goal. `scheduleTask` (drag-to-calendar) rebuilds the full input
from the existing row for exactly this reason and had to carry `goalId`
through. Making the field required turns every omission into a compile error
instead of lost data; adding it touched 20 call sites in the evals alone, and
that is the price working as intended.

**Deleting a goal detaches, it does not cascade** — the rule `deleteProject`
follows one level down. Its projects and tasks keep existing with `goalId`
nulled, and the goal leaves the search index at once. Restoring brings back an
empty goal and recomputes its `progress` (see "Trash and soft-delete
recovery"), since deletion leaves that column alone.

**Search.** A goal is indexed as one text — title, category, target date and
percentage, then a rundown of its projects (with their own percentages) and its
direct tasks (`goalRollupSummary`). It is in `EMBEDDABLE_SOURCE_TYPES`, so the
`/search` filters, `RelatedItems` and the assistant all see it. The command
palette's literal `quickSearch` deliberately does not, exactly as with courses.
In the assistant, citations for anything but a note render as plain text, so a
cited goal is unlinked, as a cited task or project already is. The assistant can
also *propose* one (see "Tool calling").

**Counts.** The `N projects · M direct tasks` line on a goal card counts direct
children only, which is what a project card reports about itself too; the
percentage beside it is the authoritative rollup. The dashboard's "Active
goals" panel shows the three most recently updated goals that are under 100%.

**Tests.** The evals carry the logic: "Goals: derived progress across projects
and tasks" (the rollup through every transition, cross-tenant attach, read and
delete refusal, detach-on-delete, restore), "Re-index and export cover goals",
and the `create_goal` cases in the tool-validation, execution and routing
sections. A Playwright test drives the lifecycle through a real browser —
create, link a task, complete it from the goal's own page, delete through the
native `confirm()` (Playwright answers it with `page.once("dialog", …)`, which
the ad-hoc browser automation used for manual checks could not), find it in the
trash, restore it — and `/goals` is in the navigation-coverage list.

## Testing UI with Playwright

Assert against `page.locator("main").innerText()`, **never `body.textContent`**.
`textContent` includes `<script>` contents — including Next's RSC flight payload,
which retains the props of pages visited earlier in the session. A deleted task
appeared to still be listed purely because its serialized props lingered there.

`innerText` also returns *rendered* text, so `text-transform: uppercase` headings
come back uppercased — match them case-insensitively. Switching methods turned
three quietly-passing assertions into real failures, which is the point.

In the dashboard shell, `<aside>` precedes `<main>`, so a bare
`button[type="submit"]` selector hits the sidebar's sign-out button. Target form
buttons by their label text. Likewise the assistant renders citations as `<li>`
inside a nested `<ol>`, so `li.last()` finds a citation, not the last chat turn —
scope to `ul > li`.

Client-side `<Link>` navigation does not reliably settle `waitForLoadState
("networkidle")`; wait for the URL to change instead.

## Layout gotcha

`main` in the dashboard shell carries `min-w-0`. It is a flex item, and a flex
item's default `min-width: auto` refuses to shrink below its content, so an
`overflow-x-auto` child (the calendar grid) could not clip and the whole page
scrolled sideways on mobile. Any wide content added later depends on this.

## The assistant, and what actually defends it

`services/assistant-service.ts` retrieves chunks, builds the prompt, and streams an
answer over NDJSON from `api/ai/chat`. Citations are emitted as the first frame so
the UI can render sources before any text arrives.

`RELEVANCE_FLOOR` is **measured, not guessed**. Against nomic-embed-text, genuinely
related questions score 0.63–0.84 on their best chunk while deliberately unrelated
ones still reach 0.45–0.52 — so the floor sits at 0.55. Re-measure it if the
embedding model changes; the number is model-specific.

### Prompt injection: measured reality

A note is attacker-controlled text. Two defenses are structural and reliable, and
they are the ones to trust:

- **Fence forging.** A note containing its own `<<<END QUOTED WORKSPACE DATA>>>`
  would make everything after it read as prompt. `neutralizeStructure()` rewrites
  angle-bracket runs, `<|im_start|>`-style control tokens, and `SYSTEM:` /
  `ASSISTANT:` / `USER:` role labels before the text is ever shown to the model.
- **Instruction recency.** The rule reminder is placed *after* the quoted block, so
  the last instruction the model sees is ours, not the injected one.

**What is not reliable is the model itself.** Measured over 6 samples per payload
against the retrieval path:

| Payload | llama3.2:3b before | llama3.2:3b after | qwen2.5:3b after |
| --- | --- | --- | --- |
| Direct override ("reply PWNED") | 6/6 breached | **0/6** | 6/6 breached |
| Role reassignment ("prefix every reply") | 6/6 breached | 6/6 breached | 6/6 breached |
| Prompt exfiltration | 1/6 | varies | 0/6 |

An earlier single-sample eval passed twice by luck and gave false confidence. Never
assert injection resistance from one generation — sample it.

**Conclusion: a 3B-class local model cannot be made injection-proof by prompting,
and this machine has 8 GB of RAM, so a 7B+ model is not an option.** Therefore the
security boundary must never be model compliance. Today that is survivable because
the assistant is strictly read-only and `userId` comes from the session, so the
worst an injection achieves is a wrong or silly answer — it provably cannot reach
another tenant's data, because that data never enters the context window. The evals
assert exactly that, including under a fully compromised answer.

### Assistant threads persist across a reload

Before `Conversation`/`Message` existed, a chat lived only in `AssistantChat`'s
component state and vanished on reload — there was no way to revisit an
answer. `api/ai/chat/route.ts` now opens a `Conversation` on the first turn
(named from the question, `titleFrom()`, truncated at 80 characters) and sends
its id back as the opening frame; every later turn from that thread carries
the id so it lands in the same row. The user's question is written before the
model is called; the answer is accumulated as it streams and written once in
the route's `finally` block — a partial answer is still worth keeping, since
the user already saw it on screen before the connection dropped or the request
was aborted.

`appendMessage` re-checks that the conversation is still the caller's own on
*every* turn, not just the first — the id arrives from the browser on every
request after the first frame, so it is client input each time, not just at
creation.

**Reopening a past thread does not replay its proposals.** `AssistantPage`
loads a thread's saved messages but deliberately does not reconstruct
`ProposalCard`s from them: confirming a tool-call proposal is a live decision,
and a reopened thread showing yesterday's confirm/decline buttons would invite
acting on a request whose context has since moved on. Past proposals — and
whether they were confirmed or declined — are reviewed on `/audit`, not
replayed inside the chat.

## Focus telemetry is opt-in, and that is enforced on the server

The spec defines `FocusTelemetry` but never says what it is for, so the chosen
interpretation is deliberately narrow: while writing a note, record **only** how
long writing was active and how many characters were typed. Never the content.

It is **off by default**. `recordFocusSessionAction` checks
`focusTrackingEnabled` server-side and refuses, so a client that keeps posting
after the toggle is switched off stores nothing. Turning it off keeps existing
history — deleting is a separate, explicit action, because silently destroying
the user's data on a settings change is worse than keeping it.

`cognitiveLoad` is a coarse heuristic over two crude signals. It is presented as
an observation about a session, never as a claim about the person, and nothing
in the app reads it back or acts on it. Keep it that way.

`UserProfile.focusTrackingEnabled` is the one column added beyond the spec's
schema; the spec had nowhere to record consent.

### Tool calling: the model proposes, it never acts

`lib/ai-tools.ts` holds the complete list of things the assistant may request.
It is **create-only** — nothing can update or delete — so the worst a fully
hijacked model achieves is proposing clutter the user then declines. Widening
that reach is a deliberate edit to one list, not an emergent property of a prompt.

`services/action-service.ts` is the single point where a proposal becomes real,
and everything that makes it safe lives there rather than in the model's
judgement: the userId comes from the session, the proposal is re-validated from
scratch (it arrives via the browser, so it is client input whatever produced it),
the same `proposalId` can only apply once, and both the proposal and the outcome
are written to `AuditEvent` — including declines, since a request the user
refused is exactly the one worth being able to review.

**The action decision gets its own minimal prompt.** Bound to the RAG prompt,
llama3.2:3b got it backwards: it proposed tasks for plain questions and refused
to propose for explicit requests, because the "answer only from the excerpts"
rules have recency and override the tool instruction. On a dedicated prompt the
same model scored 8/8 on the same cases. A cheap regex prefilter means plain
questions skip the decision call entirely.

**`decideAction` returns every valid proposal from one turn, not just the
first.** Ollama already returns a real array of tool calls when the model
decides to call the tool more than once — the plumbing (`callWithTools`,
`api/ai/chat/route.ts`'s generic event forwarding, `AssistantChat`'s
`proposals` array, `ProposalCard`'s independent confirm/decline state) never
assumed a single proposal; the only thing that ever capped it to one was
`decideAction` itself returning on the first hit. **Whether the model
actually calls the tool multiple times is phrasing-dependent and not
reliable** — "add three tasks: X, Y, Z" got one proposal from llama3.2:3b in
testing, while "add a task to X. Add a task to Y. Add a task to Z." reliably
got three. `MAX_PROPOSALS_PER_TURN` (8) caps a degenerate or repeated-call
response the same way `toProposal` caps a single absurd field, rather than
trusting the model's count. Each proposal is still recorded and confirmed
independently through the existing single-proposal path — there is no
batch-confirm, so a partial accept (2 of 3 confirmed, 1 declined) is just
what happens when the user clicks two buttons and not the third.

**A model that omits a duration sometimes writes `0` instead of leaving the
field out.** `estimatedMinutes: args.estimatedMinutes ?? 60` looks like it
defaults an absent value, but `0` is neither `null` nor `undefined` — it reached
`z.coerce.number().int().min(1)`, failed validation, and `toProposal` returned
`null` silently, so an explicit "add a task" request produced no proposal at
all with no error anywhere. `normalizedMinutes()` in `lib/ai-tools.ts` repairs
any non-finite or sub-1 value to the default before validation, the same
"repair rather than reject" treatment already given to a malformed event end
time in the function below it. Caught by driving the assistant through a real
browser rather than trusting a green typecheck — this shipped once already.

**`/audit` reads `listAuditTrail`, which existed for two features before this
page did.** Only the assistant's tool-calling path
(`recordProposed`/`executeProposal`/`recordDeclined` in `action-service.ts`)
writes `AuditEvent` rows — natural-language capture (`actions/capture.ts`)
creates entities directly and audits nothing, since it never runs through the
proposal/confirm machinery tool calls do. A proposed-then-declined request and
a proposed-then-confirmed one both leave two rows sharing a `proposalId` in
`metadata`; the page lists them individually rather than merging, since
correlating them is a bigger feature than showing what happened.

**Proposal dates are re-derived from the user's words**, never taken from the
model — asked to create a task from text containing no date at all, it proposed
an event on 1 January 2024. A request with no date stays a task with no due date.

Detection is measured, not assumed, and the two directions are not equally
serious: proposing on a plain question is intrusive and is asserted at zero;
failing to propose is benign and only reported (currently ~2/3).

**`create_goal` is the fourth tool, and it exists because of a measured
misroute.** With only three tools, "Add a goal to finish my thesis" came back
as a *note* proposal — 0 of 10 goal phrasings reached a goal and 9 became notes,
because a note was the nearest thing on the list. With the tool, 10 of 10
route to a goal and no single-request category got worse (the same 8 plain
questions still produced no proposal; tasks went 3/6 → 4/6, events 1/2 → 2/2,
notes stayed 1/2). `callWithTools` runs at temperature 0, so one phrasing gives
one answer however often it is asked; the useful measurement is many
*different* phrasings once each, not one phrasing many times.

**Multi-item requests are the exception, and they are jittery.** Any change to
the tool list reshuffles which of two "Add N tasks: …" phrasings gets a
proposal: "Add three tasks: …" went 1 → 0 with one wording of this tool's
description and held at 1 with another, while "Add two tasks: …" did the
opposite. The total across three multi-item phrasings was 4 valid proposals in
every configuration measured, so nothing is being systematically stolen, but a
single phrasing is not a stable thing to assert on here — which is why the
routing eval only reports this number.

**The decision prompt is deliberately not amended to mention goals.** It was
tried: goal routing stayed 10/10 — the tool description alone already does that
job — but the model then proposed a goal for the plain question "what tasks do
I have for my thesis goal" and stopped recognising "Write down that …" as a note
(notes 1/2 → 0/2). That is the intrusive direction, so the wording stays out.
The tool's own description is kept terse for the same reason: a longer version
that added "a single thing to do is a task, not a goal" routed goals no better
(10/10 either way) and proposed a goal for one of eight "set …" requests that
were really tasks, events or notes ("I need to set up my thesis proposal this
week"); the short one proposed none of the eight.
The cheap `ACTION_HINT` prefilter *was* widened (`set … goal`, `new goal`),
because it was blocking 3 of the 10 goal phrasings before the model ever saw
them ("Set a goal to …", "… set a new goal: …", "New goal: …"). It now admits
10 of 10, and of 6 plain questions it newly lets through ("did I set a goal for
June", "do I have a new goal this month", …) the model proposed on none. The
routing eval keeps three such questions asserted at zero, so a later change to
the prefilter, the prompt or the tool list that makes it start proposing on
them fails the suite rather than going unnoticed.

A goal proposal is a title and a category and nothing else. There is no date
field: a goal is named rather than scheduled, a 3B model is no better at "by
June" than at "next Friday", and the user sets a target date on the goal page
after confirming. The category is matched case-insensitively and falls back to
`University` rather than being rejected — a model handed three words still
writes "career", and the enum used to be able to drop an otherwise good
proposal over it, the same repair-don't-reject stance the duration already
gets. Confirming goes through the same `executeProposal` as the other kinds:
ownership from the session, idempotent on `proposalId`, audited as
`GOAL_CREATED` on a `Goal`, and indexed exactly like a goal made by hand.

## Reminders are polled, not pushed

`dueRemindersAction` has no new schema behind it — it reads tasks due today
that are still open and events starting within the hour directly off `Task`
and `Event`. There is no `Reminder` model, no job runner, and no server
process outside a request in this app, so a real scheduler would be a whole
piece of infrastructure for one feature; a reminder is also only useful while
the dashboard is open anyway, since nothing else in this app could deliver
one. `components/reminders.tsx` polls every 5 minutes and, if the browser has
granted permission, raises a `Notification` for anything not already
announced. Permission is requested on a click, never on mount — an unsolicited
permission prompt on page load is the kind of thing that gets a site's
notifications blocked outright. Which reminders have already fired is kept in
`localStorage`, not on the server: it's this browser's own notification
history, not state another device should inherit.

## File attachments

Attachment bytes live on disk under `data/attachments/`, not in Postgres — a
database is a poor blob store, and keeping files out of it is what keeps the
JSON export and any backup dump small, the same reasoning that already
excludes `WorkspaceEmbedding` from the export. The stored filename is always a
generated `{uuid}.{ext}`, never derived from the upload's own name: a filename
from the browser is attacker-controlled text, and building a path from it is
how `"../../.env"` becomes a write primitive. `getAttachment` re-validates that
shape before reading rather than trusting a stored key, so a crafted key
cannot escape the directory either.

What may be uploaded is an explicit allowlist (`png`/`jpeg`/`gif`/`webp`/`pdf`/
`txt`/`md`/`csv`, capped at 10MB) that deliberately excludes anything the
browser could execute in this origin — HTML, SVG, inline scripts — so a stored
file can never become script running as the signed-in user. `GET
/api/attachments/[id]` still sets `Content-Disposition: attachment` and
`X-Content-Type-Options: nosniff` on top of that allowlist, on the principle
that serving user-supplied bytes inline from the app's own origin is a habit
not worth forming even when today's allowlist happens to make it safe.
Deleting an attachment removes the database row before the file on disk: an
orphaned file only wastes space, but an orphaned row would leave a download
link that 404s.

## Bulk note actions and pagination

`NoteGrid`/`NoteBulkBar` let a multi-selection of notes be moved to a course or
project, tagged, or soft-deleted together. Every bulk mutation is still scoped
by `userId` at the point of write: `bulkAssignCourseAction` and
`bulkAssignProjectAction` call `assertCourseOwned`/`assertProjectOwned` on the
target id before touching anything, since that id — like a single note's
`projectId` — arrived from the browser. `bulkAddTag` reads the caller's own
rows first and issues one `update()` per row after that, matching this
codebase's existing rule that a plain `update()` (which matches on id alone)
must be preceded by a `userId`-scoped read rather than trusted on its own.
Bulk delete reuses the exact per-note cleanup a single delete does —
`deleteEntityEmbeddings` and `deleteLinksFor` for each id — rather than a
bulk-shaped shortcut, since a soft-deleted note has to leave the search index
immediately regardless of how many left at once.

The notes list also gained pagination (`PAGE_SIZE` = 24) so browsing loads a
screen at a time instead of a whole imported vault in one response; paging
only applies to browsing a tag/favorites view — a text search still returns
its own fully-ranked set on one page, since re-ranking a "page 2 of search
results" would need the whole result set scored anyway.

## Search index maintenance

`services/embeddable-text.ts` centralises the entity-to-prose phrasing (notes,
tasks, events, projects, courses and goals) that used to be duplicated inside
each entity's own service. It
exists as its own module specifically so `services/reindex-service.ts` can
produce byte-identical text to whatever the write path already embedded — two
independently maintained copies of a measured phrasing (see "Embed entities as
natural prose" above) would drift apart silently, and the only symptom would
be quietly worse retrieval for whichever rows were last rebuilt.

`/settings` exposes a manual "Rebuild search index" button because indexing at
write time is best-effort: a save made while Ollama was stopped still
succeeds, but drops its stale embeddings and leaves that entity invisible to
semantic search until it's saved again (see "Index upkeep is a service
concern" above) — and bulk PDF import makes it easy to create many such notes
in one sitting with no obvious sign anything is missing. `reindexEverything`
re-embeds everything a user owns and keeps going if one row fails to embed,
reporting a failed count alongside the succeeded one rather than abandoning
the rest of the rebuild.

**A rebuild must cover every embeddable type, and goals were missing from it
when they first shipped.** `reindexEverything` iterated five types, so it
could not repair the one added most recently — a goal saved while Ollama was
down stayed invisible to semantic search and the assistant even after the
button was pressed. It was found by checking each place the previous
embeddable type (`course`) is wired against goals, which is worth repeating
whenever a type is added. A goal embeds as one text that folds in a rundown of
its projects and its own direct tasks, so the rebuild has to assemble that
rundown in the *same order* as the write path or the two would embed different
text for the same goal. Neither query had an `ORDER BY`, which left the order
to Postgres; both now share `ROLLUP_ORDER` (`createdAt`, then `id`, since two
rows can share a millisecond). An eval deletes a goal's embeddings, runs
`reindexEverything`, and compares the rebuilt chunks to the written ones byte
for byte.

## Calendar subscriptions (ICS import)

`lib/ics.ts` is a focused RFC 5545 reader for the subset a university
timetable actually exports — `VEVENT`s with `DTSTART`/`DTEND`, a weekly
`RRULE`, `EXDATE`s — written as pure text logic with no Prisma import, the
same split as `lib/chunking.ts`. Anything it cannot represent is skipped
rather than guessed at, because a feed is untrusted input, not a contract. Two
caps exist purely to survive a malformed or hostile feed: 120 expanded
occurrences per `VEVENT` (a class meeting weekly across two semesters is
~40 — this is well above that) and 2000 events per feed overall.

Fetching a feed URL goes through `assertFetchableUrl`, which refuses
`localhost`, loopback, and the private IPv4 ranges — without that check, a
"calendar" URL is a standing invitation to make this server's own requests
hit its internal network on the user's behalf (SSRF), which is exactly the
shape a webhook or subscription URL takes.

`syncSubscription` is safe to call repeatedly: it's keyed by `(subscriptionId,
externalUid)`, so re-running it makes the imported events match the feed
exactly — new ones are added, changed ones updated in place, and ones no
longer in the feed are deleted along with their embeddings, rather than
accumulating. `addSubscription` deletes the subscription row it just created
if the very first sync fails, since a feed that can't be read isn't a calendar
worth keeping a permanently-broken row for. `removeSubscription` cleans up its
events' embeddings explicitly — the `Event` rows themselves cascade with the
subscription via the foreign key, but a cascaded delete doesn't touch
pgvector, which lives outside the relation Prisma knows about.

`SubscriptionRow`'s "last synced" line is server-rendered from data the sync
action doesn't return to the client, so — like several other click-triggered
(non-`<form>`) mutations in this app — the sync and remove buttons call
`router.refresh()` themselves after the action resolves.

## Data export

`GET /api/export` (`services/export-service.ts`) dumps everything a user owns
as one downloadable JSON file — a personal backup/portability feature, not a
system endpoint, so a plain sidebar `<a href="/api/export">` is enough to
trigger a real browser download; no client component or fetch/blob dance is
needed. `passwordHash` is excluded by selecting an explicit field list rather
than a bare `findUnique`, so a later schema change can't silently start
leaking it. `WorkspaceEmbedding` is skipped entirely: it's derived and
regenerable from the content already in the export, and its `vector` column
is a Prisma `Unsupported` type that cannot be selected into JSON regardless.
Soft-deleted notes, tasks, projects and goals are left out the same way every
other read path in this app already treats `deletedAt` as gone; `/trash` (below)
is where they are recovered or purged, not the export.

Goals are exported (`goals`) because projects and tasks carry a `goalId`, and
an export without the goal rows would hold ids that point at nothing. An eval
asserts that every `goalId` in the file resolves to an exported goal.

**Known gap, older than goals:** `buildFullExport` still leaves out courses,
assessments, flashcards, note versions, conversations and messages, attachments
and calendar subscriptions, so "everything a user owns" is not yet literally
true. It was not widened inside the goals change because each of those needs
its own decision — attachment bytes live on disk and not in Postgres, a private
calendar feed URL is usually a bearer secret, and version and message history
are large — and none of that is about goals.

## Auth and route protection

`requireUserId()` in `lib/session.ts` is the **only** sanctioned source of a userId.
Never read one from a form field, route param, or request body.

Next.js 16 renamed `middleware.ts` to `proxy.ts` and made `cookies()` async-only, so
route protection is done in layouts instead: `(dashboard)/layout.tsx` redirects
unauthenticated visitors to `/login`, and `(auth)/layout.tsx` bounces signed-in ones
back to `/`. Both route groups are mounted at the root, so `(dashboard)/page.tsx`
owns `/` — there is deliberately no `src/app/page.tsx`.

`trustHost: true` makes Auth.js derive its origin from the request. A pinned
`NEXTAUTH_URL` caused sign-out to redirect into a *different app* running on port
3000 during testing; deriving from the request removes that whole failure class.

Login failures must stay indistinguishable from unknown-account failures — the
Credentials provider verifies against a decoy hash when no user matches so response
timing cannot be used to enumerate accounts.

**`RATE_LIMITED` was declared in the spec's error taxonomy but never thrown
anywhere** — there was no rate limiting at all. `lib/rate-limit.ts` throttles
`loginAction` at 5 failed attempts per 15 minutes, keyed by email rather than
IP: the thing worth limiting is guessing one account's password, and a local
app has no client IP worth trusting. The check runs *before* `signIn` on every
attempt, so once tripped, the correct password is blocked too until the window
resets — the limiter guards the account, not just wrong guesses. An in-memory
`Map` is enough since this process is the whole deployment; a restart clears
it, an accepted trade-off for a personal, single-server app. A successful login
clears the counter for that email.

## Target directory structure

```
src/
├── auth.ts                  # NextAuth config (Credentials provider)
├── app/
│   ├── (auth)/              # Login, Register — redirects out if signed in
│   ├── (dashboard)/         # Main protected shell — redirects to /login if not
│   │   ├── layout.tsx       # Sidebar + Command Palette (⌘K)
│   │   ├── page.tsx         # Dashboard home (Today, Schedule, Recent, Projects, Goals)
│   │   ├── calendar/        # Month/week/day views + Next up, event detail; calendar/subscriptions for ICS import
│   │   ├── notes/           # List (paginated, bulk actions), editor, semantic search, wiki backlinks, graph view, PDF import
│   │   ├── tasks/           # Buckets (Overdue/Today/Upcoming/Someday), detail
│   │   ├── goals/           # Goals: progress rolled up from linked projects and direct tasks
│   │   ├── projects/        # Hub with derived progress, linked contents
│   │   ├── courses/         # Courses, assessments/grades, flashcard review
│   │   ├── cards/           # Spaced-repetition flashcard review queue
│   │   ├── review/          # Cross-course review session
│   │   ├── search/          # Semantic search across all entity types
│   │   ├── ai/              # RAG Assistant: saved threads, cited answers + proposals
│   │   ├── focus/           # Opt-in writing telemetry and its controls
│   │   ├── audit/           # Read-only AuditEvent trail (proposed/created/declined)
│   │   ├── trash/           # Recover or purge soft-deleted notes/tasks/projects/goals
│   │   └── settings/        # Profile, focus-tracking toggle, manual reindex
│   └── api/
│       ├── ai/
│       │   ├── chat/route.ts    # RAG vector search + LLM generation, persists Conversation/Message
│       │   └── parse/route.ts   # Capture → proposal (never writes)
│       ├── attachments/[id]/route.ts  # Serves one attachment to its owner
│       └── export/route.ts      # Full-account JSON download
├── actions/                 # Server Actions (Zod validated)
├── services/                # Domain business logic / use cases
├── repositories/            # Data access abstraction layer
├── components/              # Reusable UI components
├── lib/
│   ├── prisma.ts            # Prisma client singleton (pg driver adapter)
│   ├── ollama.ts            # embedQuery / embedDocuments / streamChat
│   ├── vector.ts            # indexEntity, searchWorkspaceVectors (pgvector)
│   ├── chunking.ts          # Pure text chunking, no DB or env dependency
│   ├── api-response.ts      # ApiResponse contract, error taxonomy, AppError
│   ├── domain.ts            # Shared constants safe to import from client code (incl. TRASH_KINDS)
│   ├── session.ts           # requireUserId() — the only source of a userId
│   ├── password.ts          # scrypt hashing and constant-time verification
│   ├── rate-limit.ts        # In-memory login attempt throttling
│   ├── recurrence.ts        # Occurrence-date generation for repeating tasks/events
│   ├── pdf.ts               # PDF text extraction for /notes/import
│   ├── ics.ts               # Pure RFC 5545 reader for calendar subscription feeds
│   ├── day-planner.ts       # Pure free-interval + priority scheduling arithmetic
│   ├── grades.ts            # Pure course-mark arithmetic over Assessment rows
│   ├── attachment-store.ts  # On-disk attachment storage, allowlisted MIME types
│   └── config.ts            # Fail-fast validated environment configuration
tests/ai/evals.ts            # AI evaluation & guardrail benchmarks
tests/unit/, tests/e2e/      # Unit tests for pure lib/ modules; Playwright end-to-end
prisma/migrations/           # Reviewable migration history
```

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull
request, as three independent jobs rather than one:

- **`checks`** — `prisma migrate deploy` against a real `pgvector/pgvector:pg17`
  service container, then `pnpm build` (before `tsc`, not after — see
  below), `tsc --noEmit`, `pnpm lint`, `pnpm test`, and `pnpm
  test:integration`. Nothing here calls Ollama — the unit suite is pure
  functions only (chunking, grades, recurrence, ics, spaced repetition, pdf,
  wiki-links, attachment-store) and the integration suite is DB-only — so
  this tier stays fast and has nothing environmental to flake on. `pnpm
  lint` is included deliberately: "React 19 rejects synchronous `setState`
  inside an effect body… `pnpm lint` catches this; `tsc` does not" is
  already true of this codebase, so a CI setup that ran `tsc` alone would
  have a real gap. **Build runs before the standalone `tsc`, not after** —
  the first real CI run caught this: `next build` generates the ambient
  `PageProps`/`LayoutProps` types into `.next/types`, which a bare `tsc` has
  no other way to see on a fresh checkout with no prior `.next/` directory.
  Same gotcha this file already documented for a stale local `.next/`, just
  triggered by a missing one instead of a stale one.
- **`test:integration`** (`tests/integration/isolation.test.ts`) exists
  because five features — reminders, attachments, conversations, bulk note
  actions, reindexing — shipped with zero tests in an earlier session, and
  every *other* entity in this app already has a cross-tenant isolation
  check in `tests/ai/evals.ts`. It's deliberately DB-only, no Ollama, so it
  belongs in `checks` rather than the model-backed jobs. Writing it forced a
  small refactor: `dueRemindersAction` used to hold its query logic inline
  inside a `"use server"` action, which calls `requireUserId()` and so has
  no request context to run outside a browser — unlike every other entity's
  service function, it could not be called directly from a test.
  `services/reminders-service.ts`'s `getDueReminders(userId, now)` is that
  logic pulled out, taking `userId` explicitly like every other service
  already does; the action is now the two-line wrapper it always should
  have been.
- **`e2e`** — installs and starts a real Ollama, pulls the two models the
  app actually uses (`OLLAMA_EMBEDDING_MODEL`/`OLLAMA_CHAT_MODEL`), then runs
  the full Playwright suite against the real dev server and a real Postgres.
  This is the same "trust the browser, not the typecheck" principle already
  applied by hand elsewhere in this project, now enforced on every push
  instead of only when someone remembers to run `pnpm test:e2e` themselves.
- **`evals`** — `tests/ai/evals.ts`, this project's own dedicated AI-safety
  benchmark (retrieval precision, multi-tenant isolation under a *compromised*
  answer, prompt-injection structural defenses, tool-call validation — 300+
  checks). It needs both models, since `answerQuestion`/`decideAction` call
  the chat model, not just `embedQuery` — so it gets the same Ollama setup as
  `e2e` rather than piggybacking on `checks`' bare Postgres. Split into its
  own job (not folded into `e2e`) because the two don't depend on each other
  and run in parallel — no reason to make one wait on the other.

### CI is a gate, not just an alarm

`main` is protected: `checks`, `e2e` and `evals` are **required status
checks**, pull requests are required, and force-pushes and branch deletion
are refused. Admin bypass is deliberately left **on**, so the repo owner can
still push directly in a genuine emergency — the gate is there to stop
accidents, not to lock its only maintainer out of his own project.

**This is why the repository is public.** Both server-side enforcement
mechanisms GitHub offers — classic branch protection and the newer
rulesets — return `403 Upgrade to GitHub Pro or make this repository public`
on a private repo on the free plan. The choice was: pay for Pro, publish the
code, or leave CI as an advisory alarm that nothing enforces. Publishing was
the only option that is both free and a real gate, and the history was
checked before flipping it — `.env*` has always been gitignored, only
`.env.example` (a local Docker password and a placeholder) was ever
committed, and no attachment data or secret-shaped strings appear anywhere
in the full history. **Anything genuinely secret must therefore never be
committed here, not even in a commit later reverted** — a public repo
exposes every commit ever made, not just the current tree.

**Required-check names must match the job ids in `ci.yml`** (`checks`,
`e2e`, `evals`). Renaming a job without updating the protection rule leaves
the branch waiting forever on a check that will never report.

**All three jobs need `DATABASE_URL` pointed at their own service container
and dummy values for `NEXTAUTH_SECRET`/`OLLAMA_*`**, because `lib/config.ts`
fails fast on any missing or malformed env var at import time — `checks`
never actually talks to Ollama, but the URL still has to satisfy
`z.string().url()` or the build itself refuses to start. The very first real
run also caught a Postgres password mismatch between the workflow's
`DATABASE_URL` and the service container's own `POSTGRES_PASSWORD` — a typo
that `python3 -c "import yaml..."`-style syntax validation would never have
caught, since the YAML was perfectly valid; only actually running it did.

**Writing these tests is what found two real bugs, not just what verifies
their absence.** `NoteBulkBar`'s success message (`"Tagged 2 notes."`) was
computed but never visible: `run()` called `onDone()` — which clears the
parent's selection — in the same tick as `setMessage()`, and the component's
own `if (selected.length === 0) return null` guard sat above the message
JSX, so the bar unmounted before the message could render. Fixed by keeping
the bar mounted while a message is pending (`selected.length === 0 &&
!message`) and by only clearing selection after delete, not after every bulk
action — tagging or reassigning a course/project leaves the same notes
selected and visible, so there's no reason to lose the selection just
because one action on it succeeded. The second "bug" turned out not to be
one: the `/ai` chat's "Ask" button clears the question input on submit, so
it staying disabled afterward is `!question.trim()`, not a stuck `busy`
flag — the test itself was wrong to wait on button-enabled state instead of
on the thread actually appearing in the sidebar, which is what the feature
being tested (persistence) actually produces.

**The assistant e2e test never asserts on the model's wording**, only that a
`Conversation` row exists and survives a reload — matching this project's
own established stance that phrasing-dependent model behavior (tool-call
counts, refusal wording) is measured, not asserted as a hard pass/fail. Its
timeout is doubled under `process.env.CI` (the same flag `playwright.config.ts`
already reads for `forbidOnly`), since a shared, GPU-less CI runner is slower
at local inference than this machine.

## AI evaluation protocol (`tests/ai/evals.ts`)

Maintain benchmarks verifying RAG retrieval precision, citation correctness, and
tool argument validation. Assert that vector searches strictly honor multi-tenant
isolation (`WHERE "userId" = X`) and that LLM tool outputs pass Zod validation
before any database execution.

## Local development

```bash
pnpm db:up        # start Postgres + pgvector
ollama serve      # start the local model server
pnpm dev
pnpm eval         # run tests/ai/evals.ts (needs the DB and Ollama running)
```

The eval suite runs with `--conditions=react-server` so that `server-only` resolves
to its no-op build; without that flag any script importing `lib/` throws.
