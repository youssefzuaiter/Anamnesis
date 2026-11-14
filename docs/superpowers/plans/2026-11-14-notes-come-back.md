# Notes that come back Implementation Plan

**Goal:** The dashboard shows one older note, chosen by a plain rule: a note from this day in an earlier year ("on this day") first, otherwise a note not changed for at least thirty days. The choice is stable through a day, so it does not change on each reload, and the card is hidden when there is no such note.

**Architecture:** A pure function `pickRevisit` in `src/lib/note-revisit.ts` makes the choice from the candidate notes and today's date. The service reads the caller's live notes last changed before the cutoff (capped), and the dashboard shows the card. `updatedAt` is the only time used, as the roadmap asks; no migration.

**Spec:** ROADMAP item 32: "Notes that come back (S). A dashboard card with one older note ("on this day", or one not touched for a while). Use `updatedAt`; a 'last opened' column would be a migration for a small nicety."

**Money:** none. No model.

## Global Constraints
- Only the caller's live notes; trashed and other accounts' notes never appear.
- Stable within a local day: the same inputs give the same note.
- A note changed within the last thirty days is never offered.
- Read only.

## Review Focus
1. A leap-day note on 29 February in a non-leap year is not "on this day" for 28 February.
2. A note that was edited recently is not revived because its first version was old.
3. The cap: the query reads at most 1000 candidate notes; past that, the choice is from the oldest 1000 changes.
4. Timezone: the day is the server's local day, as elsewhere in the app.

### Task 1: `src/lib/note-revisit.ts` (pure) and unit tests.
### Task 2: repository query and service, integration tests.
### Task 3: dashboard card, browser test at desktop and phone width, light and dark.
### Task 4: CLAUDE.md, README, ROADMAP.
