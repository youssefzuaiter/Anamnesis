/**
 * The assistant's two edits against a real Postgres, with the model replaced by a scripted tool
 * caller: what a proposal resolves to (Task 2) and what a confirm may do (Task 3).
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import type { ActionProposal } from "@/lib/ai-tools";
import { decideEdits } from "@/services/assistant-service";
import { executeProposal } from "@/services/action-service";

const users: string[] = [];
async function newUser() {
  const user = await prisma.user.create({ data: { email: `edits-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user.id;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const note = (userId: string, title: string, content = "Body", deletedAt: Date | null = null) =>
  prisma.note.create({ data: { userId, title, content, tags: [], deletedAt } });
const task = (userId: string, title: string, extra: Record<string, unknown> = {}) =>
  prisma.task.create({ data: { userId, title, priority: "medium", tags: [], estimatedMinutes: 60, ...extra } });
const now = new Date(2026, 10, 11, 10, 0);
/** A scripted model: returns exactly these tool calls. */
const model = (...calls: { name: string; arguments: Record<string, unknown> }[]) => async () => calls;
const refused = (code: string, message: RegExp) => (error: unknown) => error instanceof AppError && error.code === code && message.test(error.message);

test("an append resolves its note by title among the caller's live notes", async () => {
  const me = await newUser();
  const other = await newUser();
  const thesis = await note(me, "Thesis Notes", "Existing");
  await note(me, "Thesis notes draft");
  await note(me, "Old thesis", "x", new Date());
  await note(other, "Thesis notes");

  const result = await decideEdits("Add 'meeting moved to Friday' to my thesis notes", now, {
    userId: me, callTools: model({ name: "append_to_note", arguments: { note_title: "thesis   notes", text: "Meeting moved to Friday" } }),
  });
  assert.deepEqual(result.reasons, []);
  const [proposal] = result.proposals;
  assert.equal(proposal.kind, "note_append");
  assert.ok(proposal.kind === "note_append");
  assert.equal(proposal.targetId, thesis.id);
  assert.equal(proposal.targetTitle, "Thesis Notes");
  assert.equal(proposal.text, "Meeting moved to Friday");
  assert.equal(proposal.noteUpdatedAt, thesis.updatedAt.toISOString());

  for (const [title, reason] of [["Old thesis", /could not find a note called "Old thesis"/], ["Nothing like it", /could not find a note called/]] as const) {
    const missing = await decideEdits("append x to it", now, { userId: me, callTools: model({ name: "append_to_note", arguments: { note_title: title, text: "x" } }) });
    assert.deepEqual(missing.proposals, []);
    assert.match(missing.reasons[0], reason);
  }
});

test("two notes with one title are not guessed between", async () => {
  const me = await newUser();
  await note(me, "Ideas");
  await note(me, "ideas ");
  const result = await decideEdits("add x to ideas", now, { userId: me, callTools: model({ name: "append_to_note", arguments: { note_title: "Ideas", text: "x" } }) });
  assert.deepEqual(result.proposals, []);
  assert.match(result.reasons[0], /2 notes are called "Ideas"/);
});

test("'this summary' is the thread's last answer, verbatim, and a scoped thread's note is the default", async () => {
  const me = await newUser();
  const scoped = await note(me, "Optimizers");
  const answer = "Adam keeps a running mean of gradients.\n\n- β1 = 0.9\n- β2 = 0.999";
  const result = await decideEdits("Append this summary to the note", now, {
    userId: me, scopeNoteId: scoped.id, lastAnswer: answer,
    callTools: model({ name: "append_to_note", arguments: { text: "Adam is an optimizer." } }),
  });
  const [proposal] = result.proposals;
  assert.ok(proposal?.kind === "note_append");
  assert.equal(proposal.targetId, scoped.id);
  assert.equal(proposal.text, answer, "the answer itself, not the model's version of it");

  const noAnswer = await decideEdits("Append this summary to the note", now, { userId: me, scopeNoteId: scoped.id, callTools: model({ name: "append_to_note", arguments: {} }) });
  assert.deepEqual(noAnswer.proposals, []);
  assert.match(noAnswer.reasons[0], /no answer in this conversation to add yet/);

  const noTarget = await decideEdits("add 'x' to the note", now, { userId: me, callTools: model({ name: "append_to_note", arguments: { text: "x" } }) });
  assert.match(noTarget.reasons[0], /which note/i);
});

test("a reschedule takes its date from the words, finds an open task, and says when it cannot", async () => {
  const me = await newUser();
  const other = await newUser();
  const essay = await task(me, "Essay draft", { dueDate: new Date(2026, 10, 12, 14, 30), scheduledStart: new Date(2026, 10, 12, 9, 0), scheduledEnd: new Date(2026, 10, 12, 10, 0) });
  await task(me, "Done thing", { status: "done" });
  await task(other, "Essay draft");

  const result = await decideEdits("move my essay draft to next friday", now, { userId: me, callTools: model({ name: "reschedule_task", arguments: { task_title: "essay draft" } }) });
  const [proposal] = result.proposals;
  assert.ok(proposal?.kind === "task_reschedule");
  assert.equal(proposal.targetId, essay.id);
  assert.equal(proposal.fromDue, essay.dueDate!.toISOString());
  assert.equal(proposal.toDue, new Date(2026, 10, 20, 14, 30).toISOString());
  assert.equal(proposal.clearsBlock, true);

  const noDate = await decideEdits("reschedule my essay draft", now, { userId: me, callTools: model({ name: "reschedule_task", arguments: { task_title: "Essay draft" } }) });
  assert.deepEqual(noDate.proposals, []);
  assert.match(noDate.reasons[0], /did not say when/);
  const done = await decideEdits("move done thing to friday", now, { userId: me, callTools: model({ name: "reschedule_task", arguments: { task_title: "Done thing" } }) });
  assert.match(done.reasons[0], /could not find an open task called "Done thing"/);
});

test("creates still come through beside edits, and the model's own ids or dates are never used", async () => {
  const me = await newUser();
  const t = await task(me, "Report");
  const result = await decideEdits("add a task to call mum and move report to tomorrow", now, {
    userId: me,
    callTools: model(
      { name: "create_task", arguments: { title: "Call mum" } },
      { name: "reschedule_task", arguments: { task_title: "Report", targetId: randomUUID(), toDue: "2020-01-01T00:00:00Z" } },
    ),
  });
  assert.deepEqual(result.proposals.map((p) => p.kind), ["task", "task_reschedule"]);
  const reschedule = result.proposals[1];
  assert.ok(reschedule.kind === "task_reschedule");
  assert.equal(reschedule.targetId, t.id);
  assert.equal(new Date(reschedule.toDue).getDate(), 12, "tomorrow from the words, not 2020 from the model");
});

test("a target the model words loosely is still found: 'my … note', or a title the request itself contains", async () => {
  const me = await newUser();
  const reading = await note(me, "Reading list");
  await note(me, "Reading");
  const loose = await decideEdits("Add 'Deep Learning book' to my reading list note", now, {
    userId: me, callTools: model({ name: "append_to_note", arguments: { note_title: "my reading list note", text: "Deep Learning book" } }),
  });
  assert.ok(loose.proposals[0]?.kind === "note_append");
  assert.equal(loose.proposals[0].targetId, reading.id);

  const untitled = await decideEdits("Save your answer in my reading list", now, {
    userId: me, lastAnswer: "An answer.", callTools: model({ name: "append_to_note", arguments: { note_title: "", text: "" } }),
  });
  assert.ok(untitled.proposals[0]?.kind === "note_append", JSON.stringify(untitled));
  assert.equal(untitled.proposals[0].targetId, reading.id, "the longest title the request contains, as whole words");

  const essay = await task(me, "Essay draft", { dueDate: new Date(2026, 10, 12, 17) });
  const pushed = await decideEdits("Push essay draft back to the 20th of November", now, {
    userId: me, callTools: model({ name: "reschedule_task", arguments: { task_title: "the essay draft task" } }),
  });
  assert.ok(pushed.proposals[0]?.kind === "task_reschedule", JSON.stringify(pushed));
  assert.equal(pushed.proposals[0].targetId, essay.id);
  assert.equal(pushed.proposals[0].toDue, new Date(2026, 10, 20, 17).toISOString());

  await note(me, "Reading list");
  const twice = await decideEdits("Save your answer in my reading list", now, {
    userId: me, lastAnswer: "An answer.", callTools: model({ name: "append_to_note", arguments: {} }),
  });
  assert.deepEqual(twice.proposals, [], "two notes with the title the request names are not guessed between");
});

// --- Confirming ---------------------------------------------------------------------------------

const appendOf = (n: { id: string; title: string; updatedAt: Date }, text = "Added line"): ActionProposal => ({
  kind: "note_append", targetId: n.id, targetTitle: n.title, text, noteUpdatedAt: n.updatedAt.toISOString(),
});

test("confirming an append adds the text, keeps a version, audits it, and applies once", async () => {
  const me = await newUser();
  const n = await note(me, "Log", "First line");
  const proposalId = randomUUID();
  const done = await executeProposal(me, proposalId, appendOf(n), "assistant");
  assert.equal(done.href, `/notes/${n.id}`);
  const after = await prisma.note.findUniqueOrThrow({ where: { id: n.id } });
  assert.equal(after.content, "First line\n\nAdded line");
  assert.equal(await prisma.noteVersion.count({ where: { noteId: n.id } }), 1, "History can undo it");
  const audit = await prisma.auditEvent.findFirstOrThrow({ where: { userId: me, action: "NOTE_APPENDED" } });
  assert.deepEqual((audit.metadata as { before: unknown }).before, { length: 10 });

  const again = await executeProposal(me, proposalId, appendOf(n), "assistant");
  assert.equal(again.replayed, true);
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: n.id } })).content, "First line\n\nAdded line");
});

test("a confirm refuses another account's note, a trashed one, a changed one, and one that would grow too long", async () => {
  const me = await newUser();
  const other = await newUser();
  const theirs = await note(other, "Theirs", "secret");
  const trashed = await note(me, "Trashed", "x", new Date());
  const mine = await note(me, "Mine", "x");

  await assert.rejects(() => executeProposal(me, randomUUID(), appendOf(theirs), "assistant"), refused("RESOURCE_NOT_FOUND", /no longer exists/));
  await assert.rejects(() => executeProposal(me, randomUUID(), appendOf(trashed), "assistant"), refused("RESOURCE_NOT_FOUND", /no longer exists/));
  await prisma.note.update({ where: { id: mine.id }, data: { content: "edited meanwhile" } });
  await assert.rejects(() => executeProposal(me, randomUUID(), appendOf(mine), "assistant"), refused("VALIDATION_ERROR", /changed since this was proposed/));
  const fresh = await prisma.note.findUniqueOrThrow({ where: { id: mine.id } });
  await prisma.note.update({ where: { id: mine.id }, data: { content: "y".repeat(99_995) } });
  const big = await prisma.note.findUniqueOrThrow({ where: { id: mine.id } });
  await assert.rejects(() => executeProposal(me, randomUUID(), appendOf(big, "more than five"), "assistant"), refused("VALIDATION_ERROR", /longer than 100,000/));
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: theirs.id } })).content, "secret");
  assert.ok(fresh);
});

test("confirming a reschedule moves the due date, clears the block, and refuses a changed or done task", async () => {
  const me = await newUser();
  const other = await newUser();
  const t = await task(me, "Essay", { dueDate: new Date(2026, 10, 12, 14, 30), scheduledStart: new Date(2026, 10, 12, 9), scheduledEnd: new Date(2026, 10, 12, 10) });
  const to = new Date(2026, 10, 20, 14, 30);
  const proposal = (row: { id: string; title: string; dueDate: Date | null }, clearsBlock = true): ActionProposal => ({
    kind: "task_reschedule", targetId: row.id, targetTitle: row.title, fromDue: row.dueDate?.toISOString() ?? null, toDue: to.toISOString(), clearsBlock,
  });

  const theirs = await task(other, "Theirs", { dueDate: new Date(2026, 10, 12) });
  await assert.rejects(() => executeProposal(me, randomUUID(), proposal(theirs), "assistant"), refused("RESOURCE_NOT_FOUND", /no longer exists/));
  await assert.rejects(() => executeProposal(me, randomUUID(), proposal(t, false), "assistant"), refused("VALIDATION_ERROR", /changed since/), "a block that appeared or went is a change");

  await executeProposal(me, randomUUID(), proposal(t), "assistant");
  const moved = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
  assert.deepEqual(moved.dueDate, to);
  assert.equal(moved.scheduledStart, null);
  const audit = await prisma.auditEvent.findFirstOrThrow({ where: { userId: me, action: "TASK_RESCHEDULED" } });
  assert.deepEqual(audit.metadata, { proposalId: (audit.metadata as { proposalId: string }).proposalId, source: "assistant", confirmedByUser: true, before: { dueDate: t.dueDate!.toISOString() }, after: { dueDate: to.toISOString() } });

  await assert.rejects(() => executeProposal(me, randomUUID(), proposal(t), "assistant"), refused("VALIDATION_ERROR", /changed since/), "the old due date no longer matches");
  const finished = await task(me, "Finished", { status: "done", dueDate: new Date(2026, 10, 12) });
  await assert.rejects(() => executeProposal(me, randomUUID(), proposal(finished, false), "assistant"), refused("VALIDATION_ERROR", /already done/));
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: theirs.id } })).dueDate?.getDate(), 12);
});
