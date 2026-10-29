/**
 * Scoped assistant questions against a real Postgres, DB-only like the rest of
 * this tier (no Ollama): resolving a scope to what belongs to it, refusing what
 * is not the caller's, and narrowing the vector search before its cut. Vectors
 * are built in the tests, so "closer" and "farther" are exact.
 *
 * Each test makes its own accounts so one test's data cannot leak into another.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { searchWorkspaceVectors, type EmbeddableSourceType, type SourceFilter } from "@/lib/vector";
import { resolveScope } from "@/services/scope-service";
import type { AssistantScope } from "@/lib/assistant-scope";

const created: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: { email: `scope-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  created.push(user.id);
  return user;
}

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

const refusedAs = (code: string) => (error: unknown) =>
  error instanceof AppError && error.code === code;

const sorted = (ids: string[] | undefined) => [...(ids ?? [])].sort();

// Entities ------------------------------------------------------------------

const makeCourse = (userId: string, over: { code?: string; deletedAt?: Date | null } = {}) =>
  prisma.course.create({
    data: { userId, code: over.code ?? "CMP2003", title: "Machine Learning", term: "Fall 2026", deletedAt: over.deletedAt ?? null },
  });
const makeProject = (userId: string, deletedAt: Date | null = null) =>
  prisma.project.create({ data: { userId, title: "Thesis", category: "University", deletedAt } });
const makeNote = (
  userId: string,
  over: { courseId?: string | null; projectId?: string | null; deletedAt?: Date | null } = {},
) =>
  prisma.note.create({
    data: { userId, title: "A note", content: "text", tags: [], courseId: over.courseId ?? null, projectId: over.projectId ?? null, deletedAt: over.deletedAt ?? null },
  });
const makeTask = (
  userId: string,
  over: { courseId?: string | null; projectId?: string | null; deletedAt?: Date | null } = {},
) =>
  prisma.task.create({
    data: { userId, title: "A task", tags: [], estimatedMinutes: 30, courseId: over.courseId ?? null, projectId: over.projectId ?? null, deletedAt: over.deletedAt ?? null },
  });
const makeEvent = (userId: string, over: { courseId?: string | null; projectId?: string | null } = {}) =>
  prisma.event.create({
    data: { userId, title: "An event", startTime: new Date(2026, 9, 30, 9), endTime: new Date(2026, 9, 30, 10), courseId: over.courseId ?? null, projectId: over.projectId ?? null },
  });

// Vectors -------------------------------------------------------------------

const DIM = 768;
const unit = (i: number): number[] => {
  const v = new Array<number>(DIM).fill(0);
  v[i] = 1;
  return v;
};
/** Mostly the query's direction, a little of another: very close to `unit(0)`. */
const nearQuery = (other: number, weight = 0.99): number[] => {
  const v = new Array<number>(DIM).fill(0);
  v[0] = weight;
  v[other] = 1 - weight;
  return v;
};
const QUERY = unit(0);

async function embed(userId: string, sourceType: EmbeddableSourceType, sourceId: string, vector: number[]) {
  await prisma.$executeRaw`
    INSERT INTO "WorkspaceEmbedding" ("id", "userId", "sourceType", "sourceId", "contentChunk", "embedding")
    VALUES (${randomUUID()}, ${userId}, ${sourceType}, ${sourceId}, ${"chunk of " + sourceId}, ${`[${vector.join(",")}]`}::vector)`;
}

const ids = (hits: { sourceId: string }[]) => hits.map((hit) => hit.sourceId);

// Resolving a scope ---------------------------------------------------------

test("a course scope holds the course and what belongs to it, and nothing else", async () => {
  const a = await newUser();
  const c1 = await makeCourse(a.id);
  const c2 = await makeCourse(a.id, { code: "HIS1001" });
  const inC1 = await makeNote(a.id, { courseId: c1.id });
  await makeNote(a.id, { courseId: c2.id });
  await makeNote(a.id);
  await makeNote(a.id, { courseId: c1.id, deletedAt: new Date() });
  const taskC1 = await makeTask(a.id, { courseId: c1.id });
  await makeTask(a.id, { courseId: c1.id, deletedAt: new Date() });
  await makeTask(a.id, { courseId: c2.id });
  const eventC1 = await makeEvent(a.id, { courseId: c1.id });
  await makeEvent(a.id, { courseId: c2.id });
  await makeEvent(a.id);

  const resolved = await resolveScope(a.id, { kind: "course", id: c1.id });
  assert.equal(resolved.label, "CMP2003 — Machine Learning");
  assert.deepEqual(
    { course: sorted(resolved.within.course), note: sorted(resolved.within.note), task: sorted(resolved.within.task), event: sorted(resolved.within.event) },
    { course: [c1.id], note: [inC1.id], task: [taskC1.id], event: [eventC1.id] },
  );
  assert.deepEqual(Object.keys(resolved.within).sort(), ["course", "event", "note", "task"]);
});

test("a project scope holds the project and its own, and a note can sit in both a course and a project", async () => {
  const a = await newUser();
  const course = await makeCourse(a.id);
  const project = await makeProject(a.id);
  const both = await makeNote(a.id, { courseId: course.id, projectId: project.id });
  const onlyProject = await makeNote(a.id, { projectId: project.id });
  await makeNote(a.id, { courseId: course.id });
  const task = await makeTask(a.id, { projectId: project.id });
  const event = await makeEvent(a.id, { projectId: project.id });

  const resolved = await resolveScope(a.id, { kind: "project", id: project.id });
  assert.equal(resolved.label, "Thesis");
  assert.deepEqual(sorted(resolved.within.note), sorted([both.id, onlyProject.id]));
  assert.deepEqual(resolved.within.project, [project.id]);
  assert.deepEqual(resolved.within.task, [task.id]);
  assert.deepEqual(resolved.within.event, [event.id]);
  assert.ok((await resolveScope(a.id, { kind: "course", id: course.id })).within.note?.includes(both.id));
});

test("a note scope is that note alone", async () => {
  const a = await newUser();
  const course = await makeCourse(a.id);
  const note = await makeNote(a.id, { courseId: course.id });
  await makeTask(a.id, { courseId: course.id });

  const resolved = await resolveScope(a.id, { kind: "note", id: note.id });
  assert.deepEqual(resolved.within, { note: [note.id] });
});

test("an id that is not the caller's own live course, project or note is refused every time", async () => {
  const a = await newUser();
  const b = await newUser();
  const theirs = { course: await makeCourse(b.id), project: await makeProject(b.id), note: await makeNote(b.id) };
  const gone = {
    course: await makeCourse(a.id, { deletedAt: new Date() }),
    project: await makeProject(a.id, new Date()),
    note: await makeNote(a.id, { deletedAt: new Date() }),
  };
  const mine = { course: await makeCourse(a.id), project: await makeProject(a.id), note: await makeNote(a.id) };

  for (const kind of ["course", "project", "note"] as const) {
    for (const id of [theirs[kind].id, gone[kind].id, randomUUID()]) {
      await assert.rejects(() => resolveScope(a.id, { kind, id }), refusedAs("RESOURCE_NOT_FOUND"), `${kind} ${id}`);
    }
  }
  // A valid id of the wrong kind is just as unknown.
  await assert.rejects(() => resolveScope(a.id, { kind: "course", id: mine.note.id }), refusedAs("RESOURCE_NOT_FOUND"));
  await assert.rejects(() => resolveScope(a.id, { kind: "project", id: mine.course.id }), refusedAs("RESOURCE_NOT_FOUND"));
  await assert.rejects(() => resolveScope(a.id, { kind: "note", id: mine.project.id }), refusedAs("RESOURCE_NOT_FOUND"));
});

test("moving a note to another course takes effect at once, with no re-index", async () => {
  const a = await newUser();
  const c1 = await makeCourse(a.id);
  const c2 = await makeCourse(a.id, { code: "HIS1001" });
  const note = await makeNote(a.id, { courseId: c1.id });

  assert.ok((await resolveScope(a.id, { kind: "course", id: c1.id })).within.note?.includes(note.id));
  await prisma.note.update({ where: { id: note.id }, data: { courseId: c2.id } });
  assert.ok(!(await resolveScope(a.id, { kind: "course", id: c1.id })).within.note?.includes(note.id));
  assert.ok((await resolveScope(a.id, { kind: "course", id: c2.id })).within.note?.includes(note.id));
});

// Narrowing the search ------------------------------------------------------

test("the filter narrows the search before the cut, so a farther in-scope chunk wins over nearer ones outside", async () => {
  const a = await newUser();
  const inScope = randomUUID();
  await embed(a.id, "note", inScope, unit(5));
  await embed(a.id, "note", randomUUID(), nearQuery(1));
  await embed(a.id, "note", randomUUID(), nearQuery(2, 0.95));

  const scoped = await searchWorkspaceVectors(a.id, QUERY, 1, undefined, { note: [inScope] });
  assert.deepEqual(ids(scoped), [inScope]);
  const unscoped = await searchWorkspaceVectors(a.id, QUERY, 1);
  assert.notEqual(unscoped[0].sourceId, inScope);
});

test("another account's chunk is never returned, even when it is the nearest and is named in the filter", async () => {
  const a = await newUser();
  const b = await newUser();
  const mine = randomUUID();
  const theirs = randomUUID();
  await embed(a.id, "note", mine, unit(5));
  await embed(b.id, "note", theirs, nearQuery(1));

  const named = await searchWorkspaceVectors(a.id, QUERY, 8, undefined, { note: [mine, theirs] });
  assert.deepEqual(ids(named), [mine]);
  assert.ok(!ids(await searchWorkspaceVectors(a.id, QUERY, 8)).includes(theirs));
});

test("a filter that allows nothing returns nothing", async () => {
  const a = await newUser();
  await embed(a.id, "note", randomUUID(), nearQuery(1));
  assert.deepEqual(await searchWorkspaceVectors(a.id, QUERY, 8, undefined, {}), []);
  assert.deepEqual(await searchWorkspaceVectors(a.id, QUERY, 8, undefined, { note: [] }), []);
});

test("a narrow scope still finds its own chunks among hundreds that are closer", async () => {
  const a = await newUser();
  const inScope: string[] = [];
  for (const i of [710, 711, 712]) {
    const id = randomUUID();
    inScope.push(id);
    await embed(a.id, "note", id, unit(i));
  }
  for (let batch = 0; batch < 12; batch++) {
    await Promise.all(
      Array.from({ length: 50 }, (_, k) => embed(a.id, "note", randomUUID(), nearQuery(1 + ((batch * 50 + k) % 600), 0.9))),
    );
  }

  const scoped = await searchWorkspaceVectors(a.id, QUERY, 8, undefined, { note: inScope });
  assert.deepEqual(sorted(ids(scoped)), sorted(inScope));
  const unscoped = ids(await searchWorkspaceVectors(a.id, QUERY, 8));
  assert.ok(inScope.every((id) => !unscoped.includes(id)), "the in-scope chunks were meant to be far from the query");
});

test("without a filter the search is as it was: nearest first, the caller's own only", async () => {
  const a = await newUser();
  const b = await newUser();
  const nearest = randomUUID();
  const middle = randomUUID();
  const farthest = randomUUID();
  await embed(a.id, "note", farthest, unit(9));
  await embed(a.id, "task", nearest, nearQuery(1));
  await embed(a.id, "note", middle, nearQuery(2, 0.5));
  await embed(b.id, "note", randomUUID(), nearQuery(1));

  const hits = await searchWorkspaceVectors(a.id, QUERY, 8);
  assert.deepEqual(ids(hits), [nearest, middle, farthest]);
  const onlyNotes = await searchWorkspaceVectors(a.id, QUERY, 8, ["note"]);
  assert.deepEqual(ids(onlyNotes), [middle, farthest]);
});

// A scope that is typed but not used here keeps the types honest.
const _typecheck: { scope: AssistantScope; within: SourceFilter } | null = null;
void _typecheck;
