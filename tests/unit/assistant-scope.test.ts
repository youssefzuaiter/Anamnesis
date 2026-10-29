import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCOPE_KINDS,
  assistantScopeSchema,
  formatScopeParam,
  parseScopeParam,
  scopeHref,
  scopeSentence,
} from "@/lib/assistant-scope";

const ID = "5c9cfa77-4c99-4f6e-a64b-8466e70ba693";

test("the kinds are a course, a project or a note", () => {
  assert.deepEqual([...SCOPE_KINDS], ["course", "project", "note"]);
});

test("a ?scope= value of kind:uuid is read", () => {
  for (const kind of SCOPE_KINDS) {
    assert.deepEqual(parseScopeParam(`${kind}:${ID}`), { kind, id: ID });
  }
});

test("anything else in ?scope= is ignored, not guessed at", () => {
  const bad: (string | string[] | undefined)[] = [
    undefined,
    "",
    "course",
    "course:",
    "course:not-a-uuid",
    `folder:${ID}`,
    `Course:${ID}`,
    `course:${ID}:x`,
    `course:${ID} `,
    ` course:${ID}`,
    "x".repeat(5000),
    [`course:${ID}`, `note:${ID}`],
  ];
  for (const value of bad) assert.equal(parseScopeParam(value), null, String(value).slice(0, 40));
});

test("formatting and parsing round-trip", () => {
  for (const kind of SCOPE_KINDS) {
    const scope = { kind, id: ID };
    assert.deepEqual(parseScopeParam(formatScopeParam(scope)), scope);
  }
});

test("the request schema takes exactly a kind and a uuid", () => {
  assert.deepEqual(assistantScopeSchema.parse({ kind: "note", id: ID }), { kind: "note", id: ID });
  const rejected = [
    { kind: "folder", id: ID },
    { kind: "course", id: "x" },
    { kind: "course" },
    { id: ID },
    { kind: "course", id: ID, userId: "someone-else" },
    [{ kind: "course", id: ID }],
    null,
    "course:" + ID,
  ];
  for (const value of rejected) assert.equal(assistantScopeSchema.safeParse(value).success, false);
});

test("each kind has its own sentence for what is searched", () => {
  assert.equal(scopeSentence("course"), "Searching only this course: its notes, tasks, events and grades.");
  assert.equal(scopeSentence("project"), "Searching only this project: its notes, tasks and events.");
  assert.equal(scopeSentence("note"), "Searching only this note.");
});

test("the link to the assistant carries the scope", () => {
  assert.equal(scopeHref({ kind: "course", id: ID }), `/ai?scope=course:${ID}`);
});
