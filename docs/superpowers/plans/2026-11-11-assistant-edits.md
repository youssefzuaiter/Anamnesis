# Assistant Proposed Edits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The assistant may propose two edits, "append this to a note" and "reschedule a task", which the person sees exactly and confirms, audited like every proposal.

**Architecture:** Two new proposal kinds beside the four creates. The model only names a target by title and, for an append, the text; the server resolves the title among the caller's own live rows (or the thread's scoped note), takes "this summary" from the thread's last answer verbatim, takes dates from the person's words, and builds a proposal that carries the target's id and a fingerprint of its state. Confirming re-reads the target by id for the session's user, refuses if the fingerprint changed, and applies the edit through the existing services (a note append is a versioned update).

**Tech Stack:** Ollama tool calling (llama3.2:3b) as today, Zod, Prisma, the existing action service and proposal card. No migration, no dependency.

**Spec:** `ROADMAP.md` item 23: "Assistant proposed edits (M, model, security). 'Append this summary to the note', 'reschedule this task'. Still confirm-first and audited. The assistant is create-only today; widening that is a deliberate, measured change." Forks decided by an inline council (weaker than independent voices); no owner question was needed.

## Global Constraints

- Exactly two edit tools, `append_to_note` and `reschedule_task`; nothing can delete, rename or rewrite. `AI_TOOLS` is still the complete list.
- The model never supplies an id. A target is resolved by title among the caller's **live** notes or tasks (exact, case- and space-folded); none or several → no proposal, and the reply says which ("I could not find a note called …", "Several notes are called …").
- In a thread scoped to one note, a request naming no note (or "this note") targets the scoped note.
- Append text: when the request refers back ("this", "that", "the summary", "your answer", "above"), it is the thread's last assistant answer, verbatim; otherwise the model's text. 1 to 10,000 characters, and the note after the append must fit `MAX_NOTE_LENGTH`. Appended as a new paragraph after a blank line.
- Reschedule: the new date comes only from the person's words (`parseNaturalDate`); none → no proposal. Due date set to that day at the time given, else the task's old time of day, else end of day; a planned block is cleared; a done or trashed task is not a target.
- A proposal carries `targetId` and a fingerprint (`noteUpdatedAt` for an append, `fromDue` for a reschedule). Confirm re-reads the target by id **for the session's user**, refuses with `VALIDATION_ERROR` ("… changed since this was proposed. Ask again.") when the fingerprint differs, and `RESOURCE_NOT_FOUND` for another account's, a trashed or a missing id. A `proposalId` still applies once.
- Audit: `AI_MUTATION_PROPOSED` as today; on confirm `NOTE_APPENDED` / `TASK_RESCHEDULED` with `{ proposalId, source, confirmedByUser, before, after }` (the note's length before and after, the due dates).
- Plain questions must still propose nothing (asserted in the evals); everything phrasing-dependent is reported, not asserted, sampled across phrasings.

## Review Focus

1. A forged confirm: another account's `targetId`, a trashed note, a done task, a changed fingerprint, a kind switched from append to create.
2. Injected text: a note or an earlier answer that tells the model to append elsewhere or reschedule something; the card shows exactly what will be written.
3. Two notes with the same title, a title with different case or spaces, a title that is only a prefix.
4. "Reschedule X" with no date, "move X to next Friday at 3pm", a task with a planned block.
5. An append that would push a note over the limit; an empty or 10,001-character text.

---

### Task 1: Proposal kinds and pure rules (`lib/ai-tools.ts`, `lib/assistant-edits.ts`)
Kinds `note_append { targetId, targetTitle, text, noteUpdatedAt }` and `task_reschedule { targetId, targetTitle, fromDue, toDue }` in `proposalSchema`; tool definitions `append_to_note { note_title?, text? }` and `reschedule_task { task_title }`; `toEditRequest(name, args)` (unresolved, validated); `refersBack(question)`, `appendedContent(content, text)`, `rescheduledDue(old, when)`. Unit tests for each rule.

### Task 2: Resolution in the assistant (`services/assistant-service.ts`)
`decideAction(question, now, ctx?: { userId; scopeNoteId?; lastAnswer? })` resolves edit requests to proposals or to a reason; the chat route passes the thread's last answer and the scope. The prefilter admits "append", "add … to (my|the) … note", "reschedule", "move … to", "postpone", "push … to". Integration tests with an injected tool caller: resolution by title, ambiguity, scoped note, refers-back text, no date, done or trashed targets, another account's same-titled note.

### Task 3: Execution (`services/action-service.ts`, `actions/ai-actions.ts`)
`executeProposal` handles both kinds with the ownership read, fingerprint check, limits and audit. Integration tests: every Review Focus 1 and 5 case, idempotence, the version kept for an append.

### Task 4: The card (`components/proposal-card.tsx`)
"Add to note" shows the note's title and the exact text (scrollable, plain text); "Reschedule task" shows from → to and "its planned block is cleared" when it has one; the button says "Add to note" / "Reschedule". After confirming, it links to the note or task.

### Task 5: Evals (`tests/ai/evals.ts`, "Proposed edits")
Measured with the real model and reported: edit phrasings routed to the edit tools; create phrasings not stolen (the existing numbers before and after); asserted: plain questions near the new words propose nothing ("what did I add to my thesis note", "when is my essay task due", "did I move the meeting"); injection: a note whose text asks for an append to another note, asked about, proposes nothing that targets elsewhere.

### Task 6: Record
CLAUDE.md "Assistant proposed edits", README, ROADMAP tick 23.
