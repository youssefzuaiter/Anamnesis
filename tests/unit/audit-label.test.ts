import { test } from "node:test";
import assert from "node:assert/strict";
import { auditLabel } from "@/lib/audit-label";

const entry = (action: string, entityType: string, metadata: unknown, entityId = "e1", actorType = "AI_AGENT") => ({
  id: "x", actorType, action, entityType, entityId, createdAt: new Date(), metadata,
});

test("creates read as before", () => {
  assert.deepEqual(auditLabel(entry("AI_MUTATION_PROPOSED", "Task", { proposal: { kind: "task", title: "Book slot" } })), { label: 'Assistant proposed a task: "Book slot"', href: null });
  assert.deepEqual(auditLabel(entry("TASK_CREATED", "Task", {}, "t1")), { label: "Created task", href: "/tasks/t1" });
  assert.deepEqual(auditLabel(entry("AI_MUTATION_DECLINED", "Proposal", {}, "p", "USER")), { label: "You declined the assistant's proposal", href: null });
});

test("edits say what they change, and link to what they changed", () => {
  assert.deepEqual(
    auditLabel(entry("AI_MUTATION_PROPOSED", "Note", { proposal: { kind: "note_append", targetTitle: "Thesis notes", text: "x" } })),
    { label: 'Assistant proposed adding to the note "Thesis notes"', href: null },
  );
  assert.deepEqual(
    auditLabel(entry("AI_MUTATION_PROPOSED", "Task", { proposal: { kind: "task_reschedule", targetTitle: "Essay", toDue: "2026-11-20T20:59:59.999Z" } })),
    { label: 'Assistant proposed moving the task "Essay"', href: null },
  );
  assert.deepEqual(auditLabel(entry("NOTE_APPENDED", "Note", { before: { length: 10 }, after: { length: 30 } }, "n1")), { label: "Added 20 characters to a note", href: "/notes/n1" });
  assert.deepEqual(auditLabel(entry("TASK_RESCHEDULED", "Task", {}, "t1")), { label: "Moved a task's due date", href: "/tasks/t1" });
  assert.deepEqual(auditLabel(entry("SOMETHING_ELSE", "Task", null)), { label: "SOMETHING_ELSE", href: null });
});
