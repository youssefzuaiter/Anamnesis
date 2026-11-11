import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNaturalDate } from "@/lib/natural-date";
import { MAX_NOTE_LENGTH } from "@/lib/see-also";
import { proposalSchema, toEditRequest, toProposal } from "@/lib/ai-tools";
import { appendedContent, MAX_APPEND, refersBack, rescheduledDue, titleKey } from "@/lib/assistant-edits";

test("a request that points back at the conversation uses the last answer", () => {
  for (const question of [
    "Append this summary to my thesis note",
    "add that to the Optimizers note",
    "Save your answer in my reading list note",
    "put the above into my meeting note",
    "Add the summary to the note",
    "append it to the note",
  ]) {
    assert.equal(refersBack(question), true, question);
  }
  for (const question of ["Add 'meeting moved to Friday' to my thesis note", "append buy milk to my shopping note", "add a task to read the summary"]) {
    assert.equal(refersBack(question), false, question);
  }
});

test("an append goes after a blank line, and never past the note limit", () => {
  assert.equal(appendedContent("", "New text"), "New text");
  assert.equal(appendedContent("Old\n\n\n", "New"), "Old\n\nNew");
  assert.equal(appendedContent("Old", "  New  \n"), "Old\n\nNew");
  assert.equal(appendedContent("x".repeat(MAX_NOTE_LENGTH - 5), "too long"), null);
  assert.equal(appendedContent("x".repeat(MAX_NOTE_LENGTH - 10), "fits"), `${"x".repeat(MAX_NOTE_LENGTH - 10)}\n\nfits`);
});

test("a new due date comes from the words; without a time it keeps the old time of day, else the end of the day", () => {
  const now = new Date(2026, 10, 11, 10, 0);
  const oldDue = new Date(2026, 10, 12, 14, 30);
  const friday = parseNaturalDate("move it to next friday", now);
  assert.deepEqual(rescheduledDue(oldDue, friday), new Date(2026, 10, 20, 14, 30));
  assert.deepEqual(rescheduledDue(null, friday), new Date(2026, 10, 20, 23, 59, 59, 999));
  const withTime = parseNaturalDate("reschedule to friday at 3pm", now);
  assert.deepEqual(rescheduledDue(oldDue, withTime), new Date(2026, 10, 13, 15, 0));
  assert.equal(rescheduledDue(oldDue, parseNaturalDate("reschedule my essay task", now)), null, "no date in the words, no reschedule");
});

test("titles match with case and spacing folded, nothing more", () => {
  assert.equal(titleKey("  Thesis   Notes "), "thesis notes");
  assert.equal(titleKey("Thesis Notes"), titleKey("thesis notes"));
  assert.notEqual(titleKey("Thesis"), titleKey("Thesis notes"));
});

test("an edit request from the model is checked before anything is looked up", () => {
  assert.deepEqual(toEditRequest("append_to_note", { note_title: " Thesis ", text: "Hello" }), { tool: "append_to_note", noteTitle: "Thesis", text: "Hello" });
  assert.deepEqual(toEditRequest("append_to_note", {}), { tool: "append_to_note", noteTitle: null, text: null });
  assert.deepEqual(toEditRequest("reschedule_task", { task_title: "Essay" }), { tool: "reschedule_task", taskTitle: "Essay" });
  assert.equal(toEditRequest("reschedule_task", {}), null);
  assert.equal(toEditRequest("reschedule_task", { task_title: "x".repeat(201) }), null);
  assert.equal(toEditRequest("append_to_note", { text: "x".repeat(MAX_APPEND + 1) }), null);
  assert.equal(toEditRequest("delete_note", { note_title: "x" }), null);
  assert.equal(toEditRequest("create_task", { title: "x" }), null, "a create is not an edit");
});

test("an edit proposal names its target by id and carries the state it was proposed against", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const at = new Date().toISOString();
  assert.ok(proposalSchema.safeParse({ kind: "note_append", targetId: id, targetTitle: "T", text: "Hi", noteUpdatedAt: at }).success);
  assert.ok(proposalSchema.safeParse({ kind: "task_reschedule", targetId: id, targetTitle: "T", fromDue: null, toDue: at, clearsBlock: false }).success);
  for (const bad of [
    { kind: "note_append", targetId: "not-a-uuid", targetTitle: "T", text: "Hi", noteUpdatedAt: at },
    { kind: "note_append", targetId: id, targetTitle: "T", text: "", noteUpdatedAt: at },
    { kind: "note_append", targetId: id, targetTitle: "T", text: "x".repeat(MAX_APPEND + 1), noteUpdatedAt: at },
    { kind: "task_reschedule", targetId: id, targetTitle: "T", fromDue: null, toDue: "friday", clearsBlock: false },
    { kind: "note_delete", targetId: id },
  ]) {
    assert.equal(proposalSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
  }
});

test("an edit tool never becomes a create proposal", () => {
  assert.equal(toProposal("append_to_note", { title: "x", note_title: "x", text: "y" }), null);
  assert.equal(toProposal("reschedule_task", { title: "x", task_title: "x" }), null);
});
