# Calendar feed export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only `.ics` URL with an unguessable token that a phone calendar can subscribe to and that shows the account's events and open dated tasks; only a hash of the token is stored, it can be rotated or turned off, and the URL is treated as a bearer secret.

**Architecture:** A pure ICS writer (`lib/ics-write.ts`) and pure feed rules (`lib/calendar-feed.ts`: token, hash, shape, window, mapping events and tasks to calendar items); two additive nullable columns on `UserProfile` (`calendarFeedHash` unique, `calendarFeedCreatedAt`); scoped repository reads; one service (`services/calendar-feed-service.ts`); one unauthenticated route handler `GET /api/calendar/<token>.ics` (the only route outside the session, which resolves the token to a user and then reads only that user's rows); a Settings card with a client component for create, rotate and turn off.

**Tech Stack:** Next 16 route handler, Prisma 7 (additive migration), `node:crypto`, the existing `lib/ics.ts` reader for round-trip tests, Playwright. No new dependency.

**Spec:** ROADMAP item 13 (`ROADMAP.md`): "A read-only `.ics` URL with an unguessable token so a phone calendar shows tasks and events. Store only a hash of the token, allow rotating it, and treat the URL as a bearer secret." The Decisions below are the design. Read with them: CLAUDE.md "Calendar subscriptions (ICS import)", "Auth and route protection", "Data export".

## Global Constraints

- No new dependency, free local stack. One additive, nullable migration (the previous release keeps working: it does not read the columns). Hand-written SQL checked against the schema by `prisma migrate diff`, never `migrate dev`.
- The token is 32 random bytes as base64url (43 characters). Only `sha256(token)` (hex) is stored. The token is shown once, at creation or rotation; it is never logged, never stored, never in an error message, never in the JSON export.
- The route is the only one that is not behind the session. Every query after the token resolves is scoped by the resolved `userId`; the token lookup itself is the single read keyed by something other than a user, and it is by the unique hash.
- Malformed, unknown and turned-off tokens give **one identical response** (404, same body, same headers).
- The feed carries titles, times and event locations only: no descriptions, notes, project names, ids that mean anything, or imported-feed events. A feed is a bearer secret: whoever holds the URL reads it.
- Window: 30 days back to 365 days ahead, at most 2,000 events and 2,000 tasks. Open tasks only (`status` not `done`, not deleted).
- Commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never `git add -A` (`AGENTS.md` is rewritten by `next dev`). CPU budget: targeted specs at `nice -n 10`, Ollama off, one `pnpm build`, "CI runs the rest". Docker may be down: `open -a Docker`.

## Decisions (made while shaping; the council was run by me inline, so weaker than four independent voices)

1. **Tasks are `VEVENT`s, not `VTODO`s.** The point is "a phone calendar shows tasks and events": Google Calendar and Apple Calendar show events, while a `VTODO` goes to Apple Reminders or nowhere. A task with a planned block is a timed event for the block; an open task with only a due date is an all-day event on that day (the server's local calendar day, as everywhere in the app). Both are `TRANSP:TRANSPARENT` (they do not make you busy) and are titled `Task: …` / `Due: …`. **Cost accepted:** the phone cannot tick a task off.
2. **One feed per account, in two nullable `UserProfile` columns**, not a table. Rotation replaces the hash, so the old URL stops at once. **Cost accepted:** no separate link per device; revoking one phone means rotating for all.
3. **The token is in the path, 256 bits, shown once; SHA-256 is enough** (the token has the entropy of a key, so a slow hash adds nothing). Because only the hash is kept, a lost URL cannot be shown again: the person rotates. A shape check (`^[A-Za-z0-9_-]{43}$`) comes before any hash or query.
4. **Minimal content.** A bearer URL pasted into a phone is easy to leak (backups, screenshots, a shared calendar app), so the feed leaves out what is most private: descriptions and notes, and the events imported from a subscription (they are already in the phone from their source and would show twice).
5. **The writer is ours** (about 80 lines: escaping, 75-octet folding, UTC and date forms). `ical-generator` 11.1.3 is MIT with no dependencies, but the rule is no new dependency and the existing `lib/ics.ts` reader gives a round-trip test for free. **Cost if wrong:** a formatting bug a real calendar rejects; mitigated by the round trip, a strict line-length and CRLF test, and an injection test.
6. **Headers:** `text/calendar; charset=utf-8`, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `X-Content-Type-Options: nosniff`. No ETag, no CORS.
7. **No rate limit on the route** (none exists anywhere; a 256-bit token cannot be guessed, and an invalid request costs one hash and one indexed lookup). **Residual risks, stated in the docs:** the URL appears in the access log of whatever serves the app (`next dev` prints it), and an `http://` address sends it in clear: use the deployed `https://` address.

## Review Focus

- **The token must be nowhere but the URL the person copies**: not in the database (dump the profile row and search), not in a log, not in an error, not in the export.
- **Another account's events and tasks must never appear**, nor trashed or done tasks, nor imported-feed events.
- **A title that tries to inject calendar lines** (`\r\nEND:VEVENT`, a comma, semicolon, backslash, 5,000 characters, a lone surrogate) must stay one escaped, folded property.
- **Dates:** a due date stored at local end-of-day must land on that local day (including around DST changes), and an all-day event ends the next day (exclusive).
- **An account with 10,000 events** must not make an unbounded response or query.

---

### Task 1: The ICS writer

**Files:**
- Create: `src/lib/ics-write.ts`, `tests/unit/ics-write.test.ts`

**Interfaces:**
- Produces:
  - `type IcsItem = { uid: string; summary: string; location?: string | null; start: Date; end: Date; allDay?: boolean; stamp: Date; transparent?: boolean; category?: string }` — for `allDay`, `start` and `end` are Dates whose **local** calendar day is meant (end exclusive); otherwise they are instants written in UTC.
  - `escapeIcsText(text: string): string` — backslash, semicolon, comma, and every line break (CR LF, CR, LF, U+2028, U+2029, U+0085) written as `\n`; every other control character removed; lone surrogates replaced by U+FFFD.
  - `foldIcsLine(line: string): string` — lines over 75 octets cut into pieces of at most 75 octets (the continuation lines start with one space and count it), never in the middle of a UTF-8 character, joined with CRLF.
  - `buildIcs(items: IcsItem[], calendar: { name: string }): string` — `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID:-//Anamnesis//Calendar feed//EN`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`, `X-WR-CALNAME`, `REFRESH-INTERVAL;VALUE=DURATION:PT1H`, `X-PUBLISHED-TTL:PT1H`, one `VEVENT` per item (`UID`, `DTSTAMP`, `LAST-MODIFIED`, `DTSTART`/`DTEND` as `YYYYMMDDTHHMMSSZ` or `;VALUE=DATE:YYYYMMDD`, `SUMMARY` cut at 200 characters, `LOCATION` cut at 200 when present, `CATEGORIES`, `TRANSP`), `END:VCALENDAR`; every line ends CRLF; an item whose end is not after its start gets `end = start` for a timed one and the next day for an all-day one; an invalid Date skips the item.

- [ ] **Step 1: Write the failing tests** (`tests/unit/ics-write.test.ts`): `escapeIcsText` for each metacharacter and each kind of line break, a control character, a lone surrogate, and that it never returns a raw CR or LF; `foldIcsLine`: a short line unchanged, 75-octet boundary exact, a long ASCII line, a line of two-byte and four-byte characters cut only between characters (every piece valid UTF-8 and at most 75 octets, unfolding gives the original); `buildIcs`: golden output for one timed and one all-day item (exact string), every line at most 75 octets and ending CRLF, no raw CR or LF inside a property, an injection title (`Evil\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:x`) stays inside one `SUMMARY` line and the calendar has exactly the expected number of `BEGIN:VEVENT`, a 5,000-character title is cut at 200, an empty item list is a valid empty calendar, an invalid date skips the item, the end-before-start rules; **round trip**: `lib/ics.ts`'s `parseIcs` (the existing reader) reads our output back to the same uid, title, location and times for timed items; hostile 100,000-character summary, location and uid built in under 50 ms.
- [ ] **Step 2: Run to see them fail** — `nice -n 10 pnpm exec tsx --conditions=react-server --test tests/unit/ics-write.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/lib/ics-write.ts`** as specified (no regex that can backtrack on a long run).
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit** — `git add src/lib/ics-write.ts tests/unit/ics-write.test.ts && git commit -m "feat(feed): an ICS writer with escaping and folding"`.

### Task 2: Feed rules (token, window, items)

**Files:**
- Create: `src/lib/calendar-feed.ts`, `tests/unit/calendar-feed.test.ts`

**Interfaces:**
- Consumes: `IcsItem`, `buildIcs` (Task 1).
- Produces:
  - `FEED_WINDOW = { daysBack: 30, daysAhead: 365, maxItems: 2000 }`; `feedWindow(now: Date): { from: Date; to: Date }`.
  - `newFeedToken(): string` (32 random bytes, base64url, 43 characters); `hashFeedToken(token: string): string` (SHA-256 hex, 64 characters); `isFeedTokenShape(value: string): boolean`; `tokenFromFile(file: string): string | null` (`<token>.ics`, exactly one `.ics` suffix, a well-shaped token, else null).
  - `type FeedEvent = { id: string; title: string; location: string | null; startTime: Date; endTime: Date; updatedAt: Date }`; `type FeedTask = { id: string; title: string; dueDate: Date | null; scheduledStart: Date | null; scheduledEnd: Date | null; estimatedMinutes: number; updatedAt: Date }`.
  - `feedItems(events: FeedEvent[], tasks: FeedTask[]): IcsItem[]` — an event is an item (`uid` `event-<id>@anamnesis`, opaque); a task with `scheduledStart` is a timed item `Task: <title>` (end = `scheduledEnd`, else start + `estimatedMinutes`), else with `dueDate` an all-day item `Due: <title>` on the due date's local day, end the next day; a task with neither gives nothing; tasks are transparent with category `Task`; `uid` `task-<id>@anamnesis`; `stamp` is `updatedAt` (stable between fetches).
  - `renderFeed(events: FeedEvent[], tasks: FeedTask[]): string` — `buildIcs(feedItems(...), { name: "Anamnesis" })`.

- [ ] **Step 1: Write the failing tests**: `newFeedToken` is 43 base64url characters and 1,000 of them are distinct; `hashFeedToken` is 64 hex characters, stable, different for tokens one character apart, never contains the token; `isFeedTokenShape` accepts a generated token and refuses 42 and 44 characters, `+`, `/`, `=`, spaces, newlines, unicode, empty and 100,000 characters (fast); `tokenFromFile` accepts `<token>.ics` and refuses no suffix, `.ICS`? (case: exactly `.ics`), a doubled suffix, a path segment, a query-looking tail; `feedWindow` is exactly 30 days back and 365 ahead; `feedItems`: an event, a task with a block (and with no end, using the estimate), a due-only task on its **local** day (a due at 23:59:59 local and one at 00:00:00 local land on their own days; a due date across a DST change in a fixed `TZ` — run in a subprocess or set `process.env.TZ` before the dates are built — stays on its local day), neither date gives nothing, uids are stable and different for an event and a task of the same id, the all-day end is the next day (month and year end), and a task block that spans midnight is one item; `renderFeed` round-trips through `parseIcs`; 3,000 hostile titles render in under 200 ms.
- [ ] **Step 2: Run to see them fail.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `src/lib/calendar-feed.ts`.**
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit** — `git add src/lib/calendar-feed.ts tests/unit/calendar-feed.test.ts && git commit -m "feat(feed): token, window and item rules for the calendar feed"`.

### Task 3: Storage, queries and the service

**Files:**
- Create: `prisma/migrations/20261106120000_calendar_feed_token/migration.sql`, `src/services/calendar-feed-service.ts`, `tests/integration/calendar-feed.test.ts`
- Modify: `prisma/schema.prisma` (two columns on `UserProfile`), `src/lib/export-shape.ts` (`UserProfile.calendarFeedHash` in `OMITTED_COLUMNS` with its reason, and a `NOT_INCLUDED` line), `src/repositories/profile-repository.ts`, `src/repositories/event-repository.ts`, `src/repositories/task-repository.ts`; `tests/unit/export-shape.test.ts` and `tests/integration/export.test.ts` only if their lists need the new column

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - Schema: `calendarFeedHash String? @unique`, `calendarFeedCreatedAt DateTime?` on `UserProfile`; the migration is `ALTER TABLE "UserProfile" ADD COLUMN "calendarFeedHash" TEXT, ADD COLUMN "calendarFeedCreatedAt" TIMESTAMP(3);` and `CREATE UNIQUE INDEX "UserProfile_calendarFeedHash_key" ON "UserProfile"("calendarFeedHash");`, verified with `prisma migrate diff` against a throwaway database built from every migration (empty with it, exactly those statements without it), applied with `migrate deploy`.
  - Repository: `setFeedHash(userId: string, hash: string | null, now: Date): Promise<void>` (upsert, so an account with no profile row works; null clears both columns), `getFeedStatus(userId: string): Promise<{ active: boolean; createdAt: Date | null }>`, `findUserIdByFeedHash(hash: string): Promise<string | null>` (the one read keyed by the hash), `listFeedEvents(userId, from, to, take)` (the caller's events overlapping the window, `subscriptionId` null, oldest first) and `listFeedTasks(userId, from, to, take)` (the caller's open, not deleted tasks whose block overlaps the window, or with no block and a `dueDate` inside it).
  - Service: `createFeedLink(userId: string): Promise<{ token: string; createdAt: Date }>` (creates or rotates: the old hash is replaced at once), `revokeFeedLink(userId: string): Promise<void>`, `getFeedLinkStatus(userId: string): Promise<{ active: boolean; createdAt: Date | null }>`, `buildFeedForToken(token: string, now?: Date): Promise<string | null>` (shape check, hash, resolve, read, render; null for anything that does not resolve). Every function refuses a non-string or empty `userId` before a query.

- [ ] **Step 1: Write the failing tests** (`tests/integration/calendar-feed.test.ts`, two accounts): creating a link gives a token that renders that account's feed and **no other**: the other account's events and tasks, the account's done tasks, trashed tasks, imported-subscription events, events outside the window and tasks with no date are all absent; **the token is not stored**: the profile row, serialised, contains neither the token nor anything but its SHA-256 (and the same for the whole `UserProfile` table for that user); a second `createFeedLink` kills the first token at once and the second works; `revokeFeedLink` makes the token resolve to null; a profile row that does not exist yet is created; malformed tokens (empty, short, long, wrong alphabet, `../`, a valid-looking unknown one) all give null; two accounts never get the same token; `getFeedLinkStatus` follows create, rotate and revoke; hostile titles (injection, 100,000 characters) arrive as escaped, folded lines and the feed parses back with `parseIcs` to the right number of events; an account with 2,500 events and 2,500 tasks yields a bounded feed (at most 2,000 of each) in a bounded time; the JSON export of the account still passes `export.test.ts` and its file never contains the hash column; a non-string `userId` is refused before a query.
- [ ] **Step 2: Run to see them fail** (`nice -n 10 pnpm exec tsx --conditions=react-server --test --test-timeout=300000 tests/integration/calendar-feed.test.ts`; start Docker first if the daemon is down). Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the schema change and migration (replay every migration into a throwaway database to prove the SQL, then `migrate deploy` on the development database), the repository functions, the service, and the export-shape entries.
- [ ] **Step 4: Run** the new file and `tests/integration/export.test.ts` and `tests/unit/export-shape.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add` the files above (named) `&& git commit -m "feat(feed): a token hash on the profile, scoped feed queries and the service"`.

### Task 4: The route, the actions and the Settings card

**Files:**
- Create: `src/app/api/calendar/[file]/route.ts`, `src/actions/calendar-feed.ts`, `src/components/calendar-feed-card.tsx`, `tests/e2e/calendar-feed.spec.ts`
- Modify: `src/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: Task 3's service.
- Produces:
  - `GET /api/calendar/<token>.ics`: 200 `text/calendar; charset=utf-8` with the headers of Decision 6 for a live token; **404 `Not found` (identical body and headers) for a missing `.ics` suffix, a malformed token, an unknown or turned-off one**; no session is read.
  - `createFeedLinkAction(): Promise<ApiResponse<{ token: string; createdAt: string }>>` and `revokeFeedLinkAction(): Promise<ApiResponse<null>>`: `requireUserId()` first, no input, `revalidatePath("/settings")`.
  - A Settings card "Calendar feed": states not set up, just created (the full address shown once in a read-only field with Copy, the `webcal://` form, the warning that anyone with it reads the titles and times, that it is shown once, and that `localhost` only works on this computer), active (since a date, with "Make a new link" and "Turn off", each confirmed), a `role="status"` region for results; works at 375px; focus moves to the new address when it appears.

- [ ] **Step 1: Write the failing e2e tests** (`tests/e2e/calendar-feed.spec.ts`, no model): Settings offers the card; creating a link shows an address once and the card then says active without it; the address, fetched **without the session** (a fresh request context with no cookies), is a 200 `text/calendar` with the headers, `BEGIN:VCALENDAR`, and an event and a dated task created through the app, and no other text; the same address with its last character changed, with `.ics` missing and a malformed one are 404 with **byte-identical** bodies and headers; making a new link (confirm accepted with `page.once("dialog")`) kills the old address (404) and the new one works; turning off makes it 404 and the card says not set up; the address is not in the page after a reload and not in `/api/export`'s file; the phone in light and dark has no sideways overflow with the address shown (assert `scrollWidth <= clientWidth`) and touch-sized buttons.
- [ ] **Step 2: Run to see them fail** (`nice -n 10 pnpm exec playwright test tests/e2e/calendar-feed.spec.ts`, Ollama off). Expected: FAIL.
- [ ] **Step 3: Implement** the route, the two actions, the component and its placement on Settings (after "Your data").
- [ ] **Step 4: Run** `calendar-feed.spec.ts` and `export.spec.ts` (Settings changed). Expected: PASS.
- [ ] **Step 5: Commit** — `git add` the files above (named) `&& git commit -m "feat(feed): the calendar feed URL, and creating, renewing and turning it off in Settings"`.

## After the tasks (the loop, not plan tasks)

`security-review` of the diff (token handling and what reaches logs, the unauthenticated route, scoping, ICS injection, window and size bounds, timing of invalid versus valid tokens measured, the migration); mutation checks on every rule (each `userId`, the shape check, the hash, the window, the exclusions, the uniform 404, the escaping); `simplify`; `tsc`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, the targeted specs, one `pnpm build`; a look at Settings at desktop and 375px in light and dark, and the feed opened in a real ICS parser if one is available (Python `icalendar` or `vobject`; Calendar.app is not opened because it would change the person's calendar); `code-review` at xhigh; CLAUDE.md section "Calendar feed", README, ROADMAP tick, `project_nexus.md` memory.
