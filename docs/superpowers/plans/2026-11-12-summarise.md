# Summarise a Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** On any note (an imported PDF is a note), "Summarise into a new note" writes a summary the person reads in full and confirms, like any other proposal.

**Architecture:** Map then reduce. The note is cut into sections of at most 6,000 characters at paragraph breaks; the model lists each section's key points under a JSON schema; each point is kept only if its words come from its own section; the model then writes a short overview from the kept points alone. The result is a `note` proposal (title "Summary: …", tag `summary`, a first line linking back with `[[Title]]`), streamed with progress from `/api/ai/summarise`, shown on a card, and saved through the existing audited `confirmProposalAction`.

**Tech Stack:** Ollama `llama3.2:3b` through `completeJson` with an explicit context size, Zod, NDJSON streaming like the chat route. No migration, no dependency.

**Spec:** `ROADMAP.md` item 24: "Summarise a PDF or long note into a new note (S to M, model). A proposal the user confirms, like any other." Forks decided by an inline council (weaker than independent voices); no owner question was needed.

## Global Constraints

- Sections: at most 6,000 characters, cut at a blank line where one exists, else at a line break, else hard; at most 17 sections (a 100,000-character note); a section of only whitespace is skipped.
- Per section: 1 to 4 points, each 10 to 240 characters; a point is kept only if `groundedness(point, section) >= 0.5` (the quiz's measure; the floor is set from the eval's measured spread, recorded).
- Overview: one model call over the kept points only (never the note), 1 to 700 characters.
- Every model call: temperature 0, `num_ctx` 8,192, the untrusted text fenced and passed through `neutralizeStructure`, the reminder after the fence.
- The proposal: title `Summary: <note title>` (cut to 200); content starts with `> Summary of [[<title>]] by the assistant on <date>. Check it against the note before relying on it.` (the title plain, not linked, when it cannot be a wiki link), then `## Overview`, then `## Key points` as a bulleted list; tags `["summary"]`; recorded as proposed (`source: "summary"`) when shown; saved only on confirm; never more than 100,000 characters.
- The note is read by id for the session's user (another account's, trashed or missing: 404 before any model call). An empty note, or one whose sections all yield nothing usable, is refused with a sentence.
- A model failure part-way stops with a sentence and saves nothing.

## Review Focus

1. A 100,000-character note: time on this Mac, and that every section contributes.
2. A note that tells the model to write something else (injection): what reaches the proposal.
3. A note of one long line (no breaks), a note of only headings, a note in Turkish.
4. A forged confirm of a summary proposal with someone else's text: it is only a note in the caller's own account.
5. The card on a phone with a long summary.

---

### Task 1: `lib/summary.ts` (pure)
`sections(text): string[]`, `summaryNote(title, overview, points, now): { title; content }`, `keepGrounded(points, section, floor)`; prompts in `lib/summary-prompts.ts` (`pointsPrompt(section)`, `overviewPrompt(points)`), shape-tested like `quiz-prompts`.

### Task 2: `services/summary-service.ts`
`summariseNote(userId, noteId, { complete?, now?, onProgress? })` → `{ proposal, kept, dropped, sections }`; integration tests with a scripted model: ownership, empty, injection-shaped output dropped by the grounding floor, model failure, progress.

### Task 3: `/api/ai/summarise` route and the card
POST `{ noteId }` → NDJSON `progress` / `proposal` / `error`; a "Summarise" card in the note page's rail; `ProposalCard` shows a note's content; `ActionSource` gains `summary`.

### Task 4: Evals and browser test
"Summaries" eval section (`EVAL_ONLY=summary`): measured and reported (grounded share, coverage, time, injection), asserted structure; e2e: the card, a refused stranger's note, the phone.

### Task 5: Record
CLAUDE.md "Summarise a note", README, ROADMAP tick 24.
