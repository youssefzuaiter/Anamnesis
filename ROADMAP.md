# Roadmap

Features to add to Anamnesis, in the order they should be built, **one at a time**.
How each one is built is in [`CLAUDE.md`](CLAUDE.md) under "Building features, one at a
time". To build the next one, tick it off here when its pull request is merged.

Sizes: **S** is hours, **M** a day or two, **L** about a week. Tags say what extra care a
feature needs:

- **demo**: it changes how something looks, so show a design demo and get a yes first.
- **security**: it touches sign-in, user input, files, a token or an outside request.
- **migration**: it changes the database; migrations must keep the previous release working.
- **ops**: it changes how the app is run (containers, jobs, the runbook).
- **model**: it depends on the local model; measure it with the evals, never assume.
- **paid?**: a paid option exists; say so before building toward it, and build the free one.

Everything here uses the free, self-hosted stack: Postgres, Ollama and the existing
services. Nothing may need a paid API key.

## A. Quick wins

- [x] **1. Maths and code highlighting in notes** (S). Render `$...$` and `$$...$$` with KaTeX
  (free, local) and highlight fenced code, in the reading view. Fall back to the raw text
  if a formula is invalid, never an error page. Check the editor's own preview too.
- [x] **2. Note templates** (S, demo). Lecture, Cornell, paper summary, meeting. A picker on
  "New note"; the templates are data, not code, so adding one is one entry.
- [x] **3. Keyboard shortcuts and a `?` cheat-sheet** (S, demo). Go-to shortcuts (g then n for
  notes, and so on) beside the existing ⌘K and ⌘J. Never fire inside a text field.
- [x] **4. Daily note and end-of-day carry-over** (S to M, demo, migration?). One note per day,
  prefilled with that day's schedule and open tasks. "Shut down day" moves unfinished tasks
  to tomorrow in one confirmed step.

## B. Study value

- [x] **5. Exam-prep planner** (M, demo). Pick an assessment; schedule review blocks backwards
  from its date into free gaps, add the due flashcards and the course's notes. Pure
  arithmetic like `lib/day-planner.ts`, no model. Propose, then confirm, then re-derive on the
  server, the same shape as Plan my day.
- [x] **6. Scope assistant questions** (S, model). Restrict retrieval to one course, project or
  note. The evals must show another account's data still never enters the context.
- [x] **7. Link suggestions and unlinked mentions** (M, model?). "This note is close to X, link
  it?" from the existing embeddings. Suggestions never write a link by themselves.
- [x] **8. GPA and CGPA tracker** (S to M, demo, migration). Credits per course, a scale, a
  target. Pure arithmetic in `lib/`, unit-tested.
- [ ] **9. Cloze cards, per-course decks, cards from selected text** (M, migration).
- [ ] **10. "Quiz me" mode** (M, model, depends on 9). Questions from a note or course using
  cards and retrieval. Measure answer quality; do not assert on wording.

## C. Data you own

- [ ] **11. Complete the JSON export** (M). It still omits courses, assessments, flashcards,
  note versions, conversations and messages, attachments and calendar subscriptions
  (see "Data export" in `CLAUDE.md`). A private calendar feed URL is a secret: decide what
  to do with it before exporting it.
- [ ] **12. Markdown vault export and import** (M, depends on 11). A zip of `.md` files with
  `[[links]]` and attachments that Obsidian opens, and a way to restore from it.
- [ ] **13. Calendar feed export** (S to M, security). A read-only `.ics` URL with an
  unguessable token so a phone calendar shows tasks and events. Store only a hash of the
  token, allow rotating it, and treat the URL as a bearer secret.

## D. Planning depth

- [ ] **14. Subtasks and checklists** (M, migration). Progress rollups must keep counting each
  task once (see "Goals").
- [ ] **15. Kanban view for projects** (M, demo).
- [ ] **16. Hourly week and day grid** (L, demo). Drag to move, drag the edge to resize a time
  block. The redesign left this out; dropping a task still lands at 09:00 today.
- [ ] **17. Repeating items: edit this and future** (M, migration?). Today a series is
  materialised rows with a shared `recurrenceId`; keep that model.
- [ ] **18. Study time per course** (S to M, demo). From the existing timer and opt-in focus
  data. Present it as an observation, never a claim about the person.

## E. Reach beyond the open tab

- [ ] **19. Reminders when the app is closed** (M, ops, security). Reminders are polled only
  while the dashboard is open. There is no job runner, so say what fires this. Choose between
  self-hosted ntfy (a container plus a phone app) and Web Push (needs HTTPS and a service
  worker, which the app deliberately does not have); both are free. Use the `council` skill.
- [ ] **20. Web clipper** (M, security). Paste a link, save the readable article as a note with
  its source. Reuse the SSRF guard (`assertFetchableUrl`); cap size and time.
- [ ] **21. PWA share target** (S to M, ops, depends on HTTPS in F). Share a page from a phone
  into Anamnesis. Needs HTTPS.
- [ ] **22. References and citations** (M to L, migration). Store papers, cite them in notes
  with `[@key]`, import BibTeX, build a bibliography. Useful for report writing.
- [ ] **23. Assistant proposed edits** (M, model, security). "Append this summary to the
  note", "reschedule this task". Still confirm-first and audited. The assistant is
  create-only today; widening that is a deliberate, measured change.
- [ ] **24. Summarise a PDF or long note into a new note** (S to M, model). A proposal the user
  confirms, like any other.

## F. Before it faces the internet

- [ ] **25. Control registration** (S, security). An invite code or an off switch; today anyone
  who can reach `/register` can make an account.
- [ ] **26. Two-factor sign-in (TOTP)** (M, security, migration). Recovery codes; keep login
  failures indistinguishable from unknown accounts.
- [ ] **27. Session list and sign out everywhere** (S to M, security).
- [ ] **28. Encrypted off-machine backups** (S to M, ops, paid?). Encrypt first, then copy. An
  external drive is free; cloud storage costs money, so say so before building toward it.
- [ ] **29. Error and uptime alerts** (S, ops). Reuse whatever 19 chose.

## G. Added 2026-10-28

Free and self-hosted, like everything above. Numbered in the order they were added; the
order below is the order to build them in, which keeps each dependency pointing backwards.

- [ ] **30. Content-Security-Policy header** (S, security). The app sends none, and notes now
  render maths and code. Read the CSP guide in `node_modules/next/dist/docs/` first. The
  inline theme script in `src/app/layout.tsx` needs a nonce or a hash, and KaTeX's stylesheet
  and fonts must keep loading. Start in report-only mode to see what it would block, then
  enforce; the e2e suite must pass under it.
- [ ] **31. Weekly review** (S, demo). A read-only page: tasks finished, notes written, how
  goals and courses moved, what is overdue and what comes next week. Plain queries over the
  existing repositories; no model, and nothing is written.
- [ ] **32. Notes that come back** (S). A dashboard card with one older note ("on this day",
  or one not touched for a while). Use `updatedAt`; a "last opened" column would be a
  migration for a small nicety.
- [ ] **33. TODO lines become tasks** (M). Find unchecked `- [ ]` lines and `TODO:` lines in a
  note and propose tasks. Propose, confirm, then re-validate on the server, the same shape
  as Plan my day. The parsing is pure and lives in `lib/`. Decide what happens when the note
  is edited later so a line is never proposed twice.
- [ ] **34. Print-ready notes** (S, demo). A print stylesheet for a note and for a course's
  notes: no app chrome, black on white whatever the theme, maths and code still legible. The
  browser's "Save as PDF" does the rest, so nothing needs hosting.
- [ ] **35. Restore from your JSON export** (M, security, depends on 11). Import an export
  file with a preview of what would change before anything is written. The file is client
  input: every row is re-owned by the session's user, every id re-checked, and a user id or
  `passwordHash` in the file is never trusted. Importing twice must not duplicate anything.
- [ ] **36. Duplicate-note cleanup** (M, model, builds on 7). Pairs of notes whose embeddings
  are very close, on a review page: keep both, or merge (the other goes to the trash and its
  links are re-pointed). Measure the similarity threshold on real notes the way
  `RELEVANCE_FLOOR` was measured. Never merge without a confirmation.
- [ ] **37. Notion import** (M, security). Notion's Markdown and CSV export is free. Pages
  become notes, a database becomes a course or a project (the user chooses), and internal
  links become `[[wiki links]]`. Reuse the size and type caps of `/notes/import`.

Polish, any time: **Turkish interface** (M, demo). Dates and numbers are already en-GB.
