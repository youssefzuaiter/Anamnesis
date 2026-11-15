# Restore from your JSON export — plan (ROADMAP item 35)

Spec: ROADMAP item 35 ("Import an export file with a preview of what would change before anything is
written. The file is client input: every row is re-owned by the session's user, every id re-checked, and
a user id or `passwordHash` in the file is never trusted. Importing twice must not duplicate anything.")
Depends on item 11 (the export) and copies the shape of item 12 (the vault import: preview and apply are
one function, a body-bounded POST route, the file is hostile data). Not tagged *demo*: built from this plan
and looked at in the browser. Decisions below were made by me inline (a council of one), not by independent
voices; no owner-level fork, no migration, no dependency, nothing paid.

## Decisions

1. **No id from the file is ever stored.** Ids are global primary keys: a file from another server (or a
   forged one) could name an id that belongs to another account. Every created row gets a fresh id. An old id
   exists only inside one run, as a key of a map old id → the id of the row in this account (created now or
   already there), used to attach children (a task's project, a card's note). A reference to an id that is
   not in the file, not of the right kind, or not resolved becomes "none" and is counted.
2. **Identity is natural, never an id; importing twice adds nothing.** A row is "already here" when the
   account has a live row of the same kind with the same key: project = title (case-folded); goal = title;
   course = code + term; assessment = course + title + due date; note = title + SHA-256 of its LF-normalised
   text (the vault importer's rule, reused); task = title + due date + course; event = title + start + end;
   reference = key; card = note + question + cloze number. An existing row is matched, **never changed or
   deleted**: the restore only adds. A match still enters the id map, so children attach to it.
3. **What is restored:** projects, goals, courses with assessments, notes (with their tags), tasks with their
   checklist steps, events, references, and cards of the restored notes. **What is not**, and the preview says
   so: the profile and settings, audit trail, conversations and messages, focus telemetry and study sessions,
   note versions, attachment records (the bytes are not in the file), calendar subscriptions (the address is not
   in the file), links (re-derived from the note text), and anything `notIncluded` names.
4. **Everything is written through the existing services as the session's user**, so ownership checks on
   project/course/goal/assessment, indexing, link resolution and progress recalculation run as they always do.
   Rows are validated by a Zod schema per kind that lists only the fields that may be set; any other key
   (`userId`, `passwordHash`, `id` as an owner, `progress`, `completedAt` as a free field) is dropped and counted
   as ignored. Derived fields are never taken from the file: project and goal `progress` are recalculated;
   `completedAt` follows `status`.
5. **Preview and apply are one function** (`runJsonRestore(userId, bytes, { apply })`): the preview does
   everything except write, so what it says is what apply does. The browser keeps the `File` and posts it twice
   (`?mode=preview|apply`), to `POST /api/import/json`, body = the file, bounded (`checkUpload`/`readBody`
   reused, 100 MiB). Origin and `Sec-Fetch-Site` are checked as in the vault route.
6. **Limits, one place each** (`lib/restore.ts`): file 100 MiB; per kind, rows read are capped (notes 5,000,
   tasks 20,000, events 20,000, others 5,000); **created per run** notes 500, others 2,000 each — a run that hits
   one says "run it again to carry on", and because a run never duplicates, running again is the way. Strings are
   bounded as the app's own schemas bound them (a note 100,000 characters, a title 200).
7. **A file that is not an Anamnesis export is refused whole, in a sentence**: not JSON, not an object,
   `formatVersion` missing or newer than the app's (`EXPORT_FORMAT_VERSION`), or no recognised table. Version 1
   files (no `formatVersion`) are accepted for the tables they have.
8. **No credential is ever read.** The file's `user`, `profile` and every column named in `OMITTED_COLUMNS` are
   ignored; a test plants a `passwordHash`, a `userId` and a foreign `id` and asserts none reaches the database.

## Tasks

1. `lib/restore.ts` (pure, unit-tested): limits, `parseExportFile(bytes)` → typed tables or a refusal sentence,
   the per-kind Zod row schemas (strict field lists, trimmed titles, dates parsed, enums checked), natural-key
   functions (`noteKey`, `taskKey`, …), `resolveRef(map, kind, oldId)`.
2. `repositories/restore-repository.ts`: the account's existing keys for each kind in one scoped read each
   (note title + content hash computed in SQL, as the vault does); no writes.
3. `services/restore-service.ts`: `runJsonRestore`. Order: courses → projects → goals → assessments → notes →
   tasks (+ checklist) → events → references → cards; each kind builds its id map; each create goes through the
   existing service. Returns a `RestoreReport` (per kind: found, create, created, present, ignoredFields,
   unresolvedLinks, deferred, failed; plus what is not restored).
4. `app/api/import/json/route.ts`: session, `checkUpload`, `readBody`, `runJsonRestore`, JSON response.
5. Settings UI: a card beside the vault import: file input, "Check the file" (preview), the report, "Restore"
   (apply) only after a preview of the same file, with the same wording rules as the vault card.
6. Tests: unit (parse, schemas, keys), integration (every refusal, re-owning with planted keys, twice adds
   nothing, children attach to present rows, another account's rows untouched, trashed rows are not "present",
   caps), e2e (preview, apply, second apply, the phone in both schemes), mutation checks, a replay of the real
   route with forged input and no session.
7. Record in CLAUDE.md, README, ROADMAP; memory; PR.

## Review focus

- A forged `id` equal to another account's row must never touch it (fresh ids only).
- A reference to a project/course/goal that exists but belongs to another account must not attach.
- A file with 100,000-character titles, deeply nested JSON, duplicated keys, `__proto__` keys.
- A trashed row in the account is not "already here" (the restore adds a live copy beside it).
- Two runs back to back, and a run that stops at its cap, never duplicate.
