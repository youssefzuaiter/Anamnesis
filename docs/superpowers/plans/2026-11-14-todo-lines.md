# TODO lines become tasks Implementation Plan

**Goal:** A note's unchecked checkboxes (`- [ ] …`) and `TODO: …` lines can become tasks. The note page shows them as a card, the person ticks the ones to keep, and confirming creates those tasks. A line whose title already matches a task (open, done or in the trash) is never offered again.

**Architecture:** A pure parser (`src/lib/todo-lines.ts`) reads a note's text, skipping fenced code, and returns the titles, deduplicated within the note. The service re-reads the note on the server when a confirmation arrives: the browser sends only the note id and the titles the person ticked, and only titles the server's own reading of the note still contains are created. Dedup is by title (the decision made with the owner): the existing `titleKey` folding, against the caller's tasks including trashed ones. No migration.

**Spec:** ROADMAP item 33: "TODO lines become tasks (M). Find unchecked `- [ ]` lines and `TODO:` lines in a note and propose tasks. Propose, confirm, then re-validate on the server, the same shape as Plan my day. The parsing is pure and lives in `lib/`. Decide what happens when the note is edited later so a line is never proposed twice."

**Decision (asked, owner's choice):** dedup by title, no migration. Known trade-offs, stated: rewording a line makes it proposable again; deleting a task whose title is unchanged keeps it blocked only while the task still exists (trashed tasks count, purged ones do not).

## Global Constraints
- Lines inside fenced code are never read.
- `- [x]` (done) lines are never proposed.
- Titles are at most 200 characters, trimmed; empty ones are dropped.
- The caller's own tasks only; another account's task with the same title does not block a line.
- The browser's list of titles is client input: only titles the server finds in the note are created.
- No model, no migration.

## Review Focus
1. A line in a code fence, and a line in an indented list item.
2. A title matching only a trashed task.
3. A repeated confirmation creates nothing new.
4. Titles containing markup (`<img onerror>`) are stored as plain text.

### Task 1: `src/lib/todo-lines.ts` (pure) and unit tests.
### Task 2: service, integration tests (propose, apply, dedup, ownership, client-supplied titles).
### Task 3: note-page card, browser tests at desktop and phone width, light and dark.
### Task 4: CLAUDE.md, README, ROADMAP.
