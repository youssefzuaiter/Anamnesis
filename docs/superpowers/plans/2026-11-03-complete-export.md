# Complete the JSON export: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /api/export` returns everything an account owns that can safely leave the machine: add courses, assessments, flashcards, note versions, conversations and messages, attachment records and calendar subscriptions, fix the profile columns it silently dropped, and make the file say what it leaves out (ROADMAP item 11).

**Architecture:** `buildFullExport` stays one read-only function that returns one object, but every new query goes through the same two rules (scoped by `userId`; nothing whose parent is in the trash, so no id dangles). A pure module `lib/export-shape.ts` holds what the file promises (the model to key table, the deliberate omissions with their reasons, the feed-host helper, the format version). A schema-reading integration test fails whenever a Prisma model with a `userId`, or a column of an exported model, is neither exported nor on the omission list: the gap existed because nothing checked completeness.

**Tech Stack:** Next.js 16 route handler, Prisma 7 + Postgres, node:test, Playwright. No new dependency, **no migration**.

**Spec:** none written (ROADMAP item 11 is not tagged *demo*); the design is in this plan. The two forks were decided by a council I ran inline, not by independent subagents, so it is weaker than four separate voices. `CLAUDE.md` ("Data export", "File attachments", "Operations: delivery, migrations and backups", "Calendar subscriptions", "GPA and CGPA") binds.

## Global Constraints

- **Heat budget:** targeted specs only, `nice -n 10`, never the whole e2e suite, at most one `pnpm build`; **Ollama stays off** (nothing here calls a model); say "CI runs the rest".
- No new dependency; no schema change; free stack.
- Every query is scoped by `userId`, children included. `passwordHash` and a feed's `url` never appear in the output, not even as a substring.
- Soft-deleted rows stay out (the existing rule), and so does every child of an excluded parent.
- Commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `git add -A` (`next dev` rewrites `AGENTS.md`).
- Playwright: select by label and role, assert on `main`; a change to a shared page means running that page's phone specs (the lesson of item 10): here only the settings text changes.

## Decisions (for CLAUDE.md, with the cost accepted)

1. **Calendar feed URL: omitted; only its host is exported.** Council. Architect: a feed URL is a bearer credential (Google and Outlook "secret address in iCal format"), and an export is a file meant to be copied, emailed, put in a cloud. Skeptic: a university timetable URL is often not secret, but the app cannot tell which, so treat all as secret. Pragmatist: the events a feed produced are already in `events` (`subscriptionId`, `externalUid`); the row is only a pointer for re-syncing. Critic: "host only" can still leak (a token in a subdomain, `user:pass@`); an opt-in `?secrets=1` is a code path that will be forgotten. **Verdict:** `host` only (no scheme, userinfo, port, path, query or fragment), tested with a token in each part. **Cost:** a restore has to be given the URL again; residual risk: a secret inside the hostname itself.
2. **Attachment bytes are not in the JSON; the records are** (`id, noteId, filename, mimeType, byteSize, storageKey, createdAt`). Council. Architect: `ops/backup.sh` already archives `attachments.tar` beside the database dump, and item 12's zip is where files belong. Skeptic: "complete" without bytes is a half-truth; base64 is up to 10 MB x 1.37 per file in one string in one Node process. Critic: someone who keeps only the JSON believes they have everything. **Verdict:** records only, and **the file says what it leaves out** (a top-level `notIncluded` object with the reason for each: attachment files, feed URLs, the search index, deleted items, the password hash), and the settings text says so. **Cost:** the JSON alone does not restore attachments.
3. **Conversations, messages and note versions are exported** (they are the person's writing); soft-deleted rows and the children of any excluded parent are not (a trashed note's versions, attachments and cards; a deleted course's assessments; a deleted conversation's messages), so every `noteId`, `courseId` and `conversationId` in the file resolves. Cards use the existing `liveCards` rule (one source), through a new repository function.
4. **`formatVersion: 2`** (the old file had none, so it was implicitly 1) so item 12 and any reader can tell the shape.
5. **The profile is exported whole** (it dropped `targetGpa` and `gpaScale` while `CLAUDE.md` claimed they travelled: the record is corrected).
6. **`Cache-Control: no-store`** on the download. **Streaming is decided by a measurement, not assumed** (Task 3): build time, pretty-printed size and heap on a big throwaway account; if the heap peak exceeds 300 MB or the synchronous stringify blocks the process for more than 1 s at a plausible large size, the route streams section by section; otherwise the numbers and the ceiling are recorded.

## Review Focus

1. Another account's rows in this export, in any new table (T2: two accounts, every model populated for both).
2. A feed URL's token, path, query and `user:pass@`, and `passwordHash`, anywhere in the serialised file (T1 unit on `feedHost`; T2 substring search over the whole JSON).
3. A dangling id: a trashed note's versions, cards and attachments, a deleted course's assessments, a deleted conversation's messages (T2).
4. Schema drift: a new model, or a new column on an exported one, that nobody adds to the export (T2, reading `prisma/schema.prisma`).
5. A huge account: time, size, heap, and the single Node process (T3 measurement).
6. Non-ASCII and 100,000-character fields, a `Json` column and a `Date` surviving `JSON.stringify` and back (T2).
7. An unauthenticated request: 401, no data in the body (T3 browser test).

---

### Task 1: The shape of the file (`lib/export-shape.ts`)

**Files:**
- Create: `src/lib/export-shape.ts`, `tests/unit/export-shape.test.ts`

**Interfaces:**
- Produces (pure; no Prisma, no React):
  - `EXPORT_FORMAT_VERSION = 2`
  - `feedHost(url: string): string | null`: the lower-cased host of a feed URL (`webcal://`, `https://`, any scheme) and nothing else; null if it cannot be read.
  - `EXPORTED_MODELS: Readonly<Record<string, string>>`: Prisma model name to payload key, for every model with a `userId` that is exported: `UserProfile profile`, `Project projects`, `Goal goals`, `Note notes`, `Task tasks`, `Event events`, `EntityLink links`, `FocusTelemetry focusTelemetry`, `AuditEvent auditEvents`, `Course courses`, `Assessment assessments`, `Flashcard flashcards`, `NoteVersion noteVersions`, `Conversation conversations`, `Message messages`, `Attachment attachments`, `CalendarSubscription calendarSubscriptions`.
  - `NOT_EXPORTED: Readonly<Record<string, string>>`: `{ WorkspaceEmbedding: <why> }`.
  - `OMITTED_COLUMNS: Readonly<Record<string, Readonly<Record<string, string>>>>`: `{ User: { passwordHash }, CalendarSubscription: { url } }`, each with its reason.
  - `NOT_INCLUDED: Readonly<Record<string, string>>`: the plain-language list the file carries as `notIncluded` (keys `attachmentFiles`, `calendarFeedUrls`, `searchIndex`, `deletedItems`, `passwordHash`).

- [ ] **Step 1: Write the failing tests** (`tests/unit/export-shape.test.ts`): `feedHost("webcal://user:pass@Cal.Example.com:8443/a/SECRETTOKEN/basic.ics?token=Q#frag")` is `"cal.example.com"`; for each of an `https://` URL with a token in the path, in the query, in the userinfo and in the fragment the output contains none of the secret strings; a bare host, `"not a url"`, `""` and a 100,000-character string give `null` or a host without throwing, in under 50 ms; IPv6 `https://[::1]:3000/x` gives `"[::1]"`; every key of `NOT_INCLUDED` has a non-empty reason; the values of `EXPORTED_MODELS` are unique and none is `user`, `exportedAt`, `formatVersion` or `notIncluded`.
- [ ] **Step 2: Run** `nice -n 10 pnpm exec tsx --conditions=react-server --test tests/unit/export-shape.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the module. `feedHost` parses with `new URL`, returns `.hostname` lower-cased (bracketed for IPv6), null in a catch; never returns the input.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/export-shape.ts tests/unit/export-shape.test.ts && git commit` ("Describe the export's shape: what it promises and what it leaves out").

### Task 2: The service and its completeness, isolation and secrecy tests

**Files:**
- Modify: `src/services/export-service.ts`, `src/repositories/flashcard-repository.ts` (add `listLiveForExport`)
- Create: `tests/integration/export.test.ts`

**Interfaces:**
- Consumes: Task 1's tables, `feedHost`, `EXPORT_FORMAT_VERSION`, `NOT_INCLUDED`.
- Produces: `listLiveForExport(userId: string): Promise<Flashcard[]>` (the `liveCards` rule, oldest first); `buildFullExport(userId: string)` returns today's keys plus `formatVersion`, `notIncluded`, `courses`, `assessments`, `flashcards`, `noteVersions`, `conversations`, `messages`, `attachments`, `calendarSubscriptions` (rows without `url`, with `host`), a whole `profile`.

- [ ] **Step 1: Write the failing tests** (`tests/integration/export.test.ts`, each test makes its own accounts and deletes them): (a) **completeness**: parse `prisma/schema.prisma`; the models that have a `userId` column equal `Object.keys(EXPORTED_MODELS)` plus `Object.keys(NOT_EXPORTED)`; for a fully populated account (one row of every exported model, `UserProfile` with `targetGpa` and `gpaScale`) each payload key in `EXPORTED_MODELS` is present, and for each model every scalar column of the schema except `OMITTED_COLUMNS` is a key of its rows, and every omitted column is absent; `User` rows carry no `passwordHash`. (b) **isolation**: a second account with a row in every model; none of its ids appear anywhere in the first account's payload (`JSON.stringify` and look for each id). (c) **secrecy**: a calendar subscription whose url holds a token in userinfo, path, query and fragment, and a `passwordHash` of a known string: neither any token nor the hash appears in `JSON.stringify(payload)`; the subscription row has `host`. (d) **no dangling ids**: a trashed note with a version, a card and an attachment, a soft-deleted course with an assessment, a soft-deleted conversation with a message are all absent, and every `noteId`, `courseId`, `conversationId` in `noteVersions`, `flashcards`, `attachments`, `assessments`, `messages` resolves to an exported row (cards with no note stay). (e) **round trip**: a note title and body of 100,000 characters of mixed non-ASCII (Turkish İ, emoji, CJK, a lone ` `), a `Message.citations` JSON object and a `lastSyncedAt` Date survive `JSON.parse(JSON.stringify(payload))` unchanged. (f) `formatVersion === 2` and `notIncluded` has the five keys.
- [ ] **Step 2: Run** `nice -n 10 pnpm exec tsx --conditions=react-server --test tests/integration/export.test.ts`. Expected: FAIL on the missing keys (and on the dropped profile columns).
- [ ] **Step 3: Implement.** Add the repository function using `liveCards`; in `buildFullExport` read every new table in the same `Promise.all`, each `where` carrying `userId`; children filter on the parent's liveness through the relation (`note: { deletedAt: null }`, `course: { deletedAt: null }`, `conversation: { deletedAt: null }`); the profile is read whole; the subscription select omits `url` and adds `host: feedHost(url)` by reading `url` only to compute it, never returning it.
- [ ] **Step 4: Run** the same command and the older integration file `tests/integration/isolation.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** ("Export courses, grades, cards, versions, conversations, attachment records and feeds").

### Task 3: The route, the measurement and the words

**Files:**
- Modify: `src/app/api/export/route.ts`, `src/app/(dashboard)/settings/page.tsx`, `README.md`
- Create: `tests/e2e/export.spec.ts`; a scratch measurement script in the scratchpad (not committed)

**Interfaces:** Consumes Task 2's `buildFullExport`. Produces the HTTP behaviour (`Cache-Control: no-store`, `Content-Disposition: attachment`, 401 with `{ success: false, data: null, error }` when signed out).

- [ ] **Step 1: Measure** on a throwaway account (deleted after): 2,000 notes of about 5 KB with 10 versions each, 20,000 cards, 5,000 messages, 300 courses' worth of assessments, 100 attachment records, then 3,000 notes of 100,000 characters (the worst the app allows). Record build time, `JSON.stringify(payload, null, 2)` time, size and the heap peak. Apply the rule in Decision 6. If it fires, add a streaming route in this task with the same tests; if not, record the numbers and where it would break.
- [ ] **Step 2: Write the failing browser test** (`tests/e2e/export.spec.ts`, no model): signed out (a fresh request context with no storage state) `GET /api/export` is 401 and the body has `data: null` and no `user`; signed in it is 200 with `content-disposition` containing `attachment` and `cache-control` containing `no-store`, JSON with `formatVersion` 2, a note the test just made, and `notIncluded`; the settings page link reads "Download everything as JSON" and the text beside it says that attachment files and calendar feed addresses are not inside.
- [ ] **Step 3: Run** `nice -n 10 pnpm exec playwright test tests/e2e/export.spec.ts`. Expected: FAIL on the header and the settings text.
- [ ] **Step 4: Implement** the header, the settings sentence, and the README (the feature line, the `/api/export` line and the Limitations bullet "Export is incomplete", which now says what is left out and why).
- [ ] **Step 5: Run** the spec again. Expected: PASS. **Commit** ("Say what the export leaves out, and keep the download out of caches").

### Task 4: Guard, mutate, record, ship

**Files:** Modify `CLAUDE.md` ("Data export": the new section, the corrected profile claim, the gap now closed), `ROADMAP.md` (tick item 11).

- [ ] **Step 1: Security review** (`security-review`) of the whole diff: every query scoped, children included; nothing secret reachable by any path; the 401 body; the unscoped-by-id surfaces (none new); **measure** the cost of the worst account (Task 3's numbers) and a hostile 100,000-character feed URL through `feedHost`. Fix any real finding test-first.
- [ ] **Step 2: Mutation-check** (backup verified, one literal edit, narrowest test, restore, `cmp`; exit 126/127 is an error): drop `userId` from each new query (one at a time); drop a parent-liveness filter (one at a time); select `url` into the subscription row; add `passwordHash` to the user select; drop `formatVersion`; leave a model out of `EXPORTED_MODELS`; add a column to the schema's omitted set without a reason (the test must name it). Each must fail a test.
- [ ] **Step 3: `simplify`** (inline); check chain: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, the one browser spec, one `pnpm build`; look at `/settings` in the browser at desktop and 375px, light and dark, and read the real downloaded file (key list, size).
- [ ] **Step 4: Record** in `CLAUDE.md`, README and ROADMAP as above.
- [ ] **Step 5: `code-review`** at the highest effort, fixing findings test-first (`ReportFindings` once, then again with outcomes); push `complete-export`; open the PR with `gh`; `get_status` once; report the checks once. Stop there.
