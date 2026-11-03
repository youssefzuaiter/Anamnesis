/**
 * The JSON export against a real Postgres, DB-only like the rest of this tier. What it promises is
 * written down in `lib/export-shape.ts`; these tests hold the service to that and to the schema, so
 * a model or a column added later cannot be forgotten: that is how the first export came to leave
 * out courses, cards, versions, conversations, attachments and feeds, and a profile's GPA columns.
 *
 * Each test makes its own accounts so one test's rows cannot leak into another's.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { EXPORTED_MODELS, EXPORT_FORMAT_VERSION, NOT_EXPORTED, NOT_INCLUDED, OMITTED_COLUMNS } from "@/lib/export-shape";
import { buildFullExport, streamFullExport } from "@/services/export-service";

const created: string[] = [];
async function newUser(passwordHash = "x"): Promise<{ id: string; email: string }> {
  const user = await prisma.user.create({ data: { email: `export-${randomUUID()}@test.local`, passwordHash } });
  created.push(user.id);
  return user;
}

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

// --- The schema, read as text: which models hold a user's data and which columns each has ---------

const SCALARS = new Set(["String", "Int", "Float", "Boolean", "DateTime", "Json", "BigInt", "Decimal", "Bytes"]);

function readSchema(): Record<string, string[]> {
  const text = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const models: Record<string, string[]> = {};
  for (const match of text.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)) {
    const columns: string[] = [];
    for (const line of match[2].split("\n")) {
      const field = line.match(/^\s+(\w+)\s+(\w+)(\[\])?\??(\s|$)/);
      if (field && SCALARS.has(field[2])) columns.push(field[1]);
    }
    models[match[1]] = columns;
  }
  return models;
}

type Payload = Record<string, unknown>;
const rowsOf = (payload: Payload, key: string): Record<string, unknown>[] => {
  const value = payload[key];
  return (Array.isArray(value) ? value : value ? [value] : []) as Record<string, unknown>[];
};

// --- A fully populated account: one row of every model that holds a user's data ---------------------

const SENTINEL = {
  user: "pw-hash-SENTINEL",
  userinfo: "FEED-PASSWORD-SENTINEL",
  path: "FEED-PATH-SENTINEL",
  query: "FEED-QUERY-SENTINEL",
  fragment: "FEED-FRAGMENT-SENTINEL",
};
const FEED_URL = `https://alice:${SENTINEL.userinfo}@Cal.Example.com:8443/ical/${SENTINEL.path}/basic.ics?private=${SENTINEL.query}#${SENTINEL.fragment}`;

async function populate(userId: string, label: string) {
  const goal = await prisma.goal.create({ data: { userId, title: `Goal ${label}`, category: "Personal" } });
  const project = await prisma.project.create({ data: { userId, goalId: goal.id, title: `Project ${label}`, category: "Personal" } });
  const course = await prisma.course.create({ data: { userId, code: "EX1", title: `Course ${label}`, term: "Fall 2026", credits: 4, finalGrade: "AA" } });
  const assessment = await prisma.assessment.create({ data: { userId, courseId: course.id, title: `Midterm ${label}`, weight: 30, score: 80 } });
  const note = await prisma.note.create({
    data: { userId, courseId: course.id, projectId: project.id, title: `Note ${label}`, content: `Body ${label}`, tags: ["a", "b"] },
  });
  const version = await prisma.noteVersion.create({ data: { userId, noteId: note.id, title: `Old ${label}`, content: `Older body ${label}` } });
  const attachment = await prisma.attachment.create({
    data: { userId, noteId: note.id, filename: `file-${label}.pdf`, mimeType: "application/pdf", byteSize: 1234, storageKey: `${randomUUID()}.pdf` },
  });
  const card = await prisma.flashcard.create({ data: { userId, noteId: note.id, question: `Q ${label}?`, answer: `A ${label}` } });
  const task = await prisma.task.create({
    data: { userId, projectId: project.id, courseId: course.id, noteId: note.id, goalId: goal.id, assessmentId: assessment.id, title: `Task ${label}`, tags: ["t"] },
  });
  const subscription = await prisma.calendarSubscription.create({
    data: { userId, name: `Feed ${label}`, url: FEED_URL, lastSyncedAt: new Date("2026-10-31T08:30:00.000Z"), lastEventCount: 3 },
  });
  const event = await prisma.event.create({
    data: {
      userId, projectId: project.id, courseId: course.id, subscriptionId: subscription.id, externalUid: `uid-${label}`,
      title: `Event ${label}`, startTime: new Date("2026-11-04T09:00:00.000Z"), endTime: new Date("2026-11-04T10:00:00.000Z"),
    },
  });
  const link = await prisma.entityLink.create({ data: { userId, sourceType: "note", sourceId: note.id, targetType: "note", targetId: note.id } });
  const telemetry = await prisma.focusTelemetry.create({ data: { userId, sessionDuration: 60, typingSpeedWpm: 40, cognitiveLoad: "low" } });
  const audit = await prisma.auditEvent.create({
    data: { userId, actorType: "USER", action: "NOTE_CREATED", entityType: "Note", entityId: note.id, metadata: { label } },
  });
  const conversation = await prisma.conversation.create({ data: { userId, title: `Chat ${label}` } });
  const message = await prisma.message.create({
    data: { userId, conversationId: conversation.id, role: "user", content: `Hello ${label}`, citations: [{ index: 1, title: `Cited ${label}` }] },
  });
  const profile = await prisma.userProfile.create({
    data: { userId, university: `Uni ${label}`, program: "AI", studentId: "123", targetGpa: 3.25, gpaScale: [{ letter: "AA", points: 4 }] },
  });
  return {
    ids: [goal, project, course, assessment, note, version, attachment, card, task, subscription, event, link, telemetry, audit, conversation, message, profile].map((row) => row.id),
    note, course, conversation,
  };
}

// --- Tests ------------------------------------------------------------------------------------------

test("the models that hold a user's data are exactly the ones the export lists or excuses", () => {
  const models = readSchema();
  const withUserId = Object.keys(models).filter((name) => models[name].includes("userId")).sort();
  assert.deepEqual(withUserId, [...Object.keys(EXPORTED_MODELS), ...Object.keys(NOT_EXPORTED)].sort());
  assert.ok(withUserId.length >= 17, "the parser found the schema");
});

test("every exported model arrives whole: every column, minus the stated omissions", async () => {
  const user = await newUser(SENTINEL.user);
  await populate(user.id, "whole");
  const payload = (await buildFullExport(user.id)) as unknown as Payload;
  const models = readSchema();

  for (const [model, key] of Object.entries(EXPORTED_MODELS)) {
    const rows = rowsOf(payload, key);
    assert.ok(rows.length > 0, `${model}: the file has a row under "${key}"`);
    const omitted = Object.keys(OMITTED_COLUMNS[model] ?? {});
    for (const column of models[model]) {
      if (omitted.includes(column)) assert.ok(!(column in rows[0]), `${model}.${column} is left out`);
      else assert.ok(column in rows[0], `${model}.${column} is in the file`);
    }
  }

  // The root model has no userId, so it is checked on its own.
  const userRow = payload.user as Record<string, unknown>;
  for (const column of readSchema().User) {
    if (column === "passwordHash") assert.ok(!(column in userRow), "User.passwordHash is left out");
    else assert.ok(column in userRow, `User.${column} is in the file`);
  }
  const profile = rowsOf(payload, "profile")[0];
  assert.equal(profile.targetGpa, 3.25, "the GPA target the old export dropped");
  assert.deepEqual(profile.gpaScale, [{ letter: "AA", points: 4 }]);
});

test("the file says what version it is and what it leaves out", async () => {
  const user = await newUser();
  const payload = (await buildFullExport(user.id)) as unknown as Payload;
  assert.equal(payload.formatVersion, EXPORT_FORMAT_VERSION);
  assert.deepEqual(payload.notIncluded, NOT_INCLUDED);
  assert.ok(!Number.isNaN(Date.parse(String(payload.exportedAt))));
});

test("an empty account exports cleanly: empty lists and no profile", async () => {
  const user = await newUser();
  const payload = (await buildFullExport(user.id)) as unknown as Payload;
  assert.equal((payload.user as { id: string }).id, user.id);
  for (const [model, key] of Object.entries(EXPORTED_MODELS)) {
    if (model === "UserProfile") assert.equal(payload[key], null);
    else assert.deepEqual(payload[key], [], key);
  }
});

test("another account's rows never appear, in any table, and every row is the caller's", async () => {
  const mine = await newUser();
  const theirs = await newUser();
  await populate(mine.id, "mine");
  const other = await populate(theirs.id, "theirs");

  const payload = (await buildFullExport(mine.id)) as unknown as Payload;
  const json = JSON.stringify(payload);
  for (const id of other.ids) assert.ok(!json.includes(id), `a foreign row ${id} is in the file`);
  assert.ok(!json.includes(theirs.id) && !json.includes(theirs.email) && !json.includes("theirs"));

  for (const key of Object.values(EXPORTED_MODELS)) {
    for (const row of rowsOf(payload, key)) assert.equal(row.userId, mine.id, `${key}: a row of someone else`);
  }
});

test("a feed's address and a password hash are nowhere in the file, even as a substring", async () => {
  const user = await newUser(SENTINEL.user);
  await populate(user.id, "secret");
  const payload = (await buildFullExport(user.id)) as unknown as Payload;
  const json = JSON.stringify(payload);

  for (const secret of Object.values(SENTINEL)) assert.ok(!json.includes(secret), `${secret} leaked`);
  assert.ok(!json.includes("alice") && !json.includes("8443") && !json.includes("basic.ics"));

  const [feed] = rowsOf(payload, "calendarSubscriptions");
  assert.equal(feed.host, "cal.example.com");
  assert.ok(!("url" in feed));
  assert.equal(feed.name, "Feed secret");
  assert.equal(feed.lastEventCount, 3);
});

test("nothing that belongs to a deleted parent is exported, so no child points at a missing parent", async () => {
  const user = await newUser();
  const live = await populate(user.id, "live");

  // A note in the trash, with a version, a card and an attachment of its own.
  const trashed = await prisma.note.create({ data: { userId: user.id, title: "Trashed", content: "gone", tags: [], deletedAt: new Date() } });
  const trashedVersion = await prisma.noteVersion.create({ data: { userId: user.id, noteId: trashed.id, title: "v", content: "gone" } });
  const trashedCard = await prisma.flashcard.create({ data: { userId: user.id, noteId: trashed.id, question: "gone?", answer: "gone" } });
  const trashedFile = await prisma.attachment.create({
    data: { userId: user.id, noteId: trashed.id, filename: "gone.pdf", mimeType: "application/pdf", byteSize: 1, storageKey: `${randomUUID()}.pdf` },
  });
  // A deleted course with an assessment, and a deleted conversation with a message.
  const goneCourse = await prisma.course.create({ data: { userId: user.id, code: "GONE", title: "Gone", term: "x", deletedAt: new Date() } });
  const goneAssessment = await prisma.assessment.create({ data: { userId: user.id, courseId: goneCourse.id, title: "Gone", weight: 10 } });
  const goneChat = await prisma.conversation.create({ data: { userId: user.id, title: "Gone", deletedAt: new Date() } });
  const goneMessage = await prisma.message.create({ data: { userId: user.id, conversationId: goneChat.id, role: "user", content: "gone" } });
  // The older rule, for the entities that were always soft-deleted.
  const trashedProject = await prisma.project.create({ data: { userId: user.id, title: "Gone", category: "Personal", deletedAt: new Date() } });
  const trashedGoal = await prisma.goal.create({ data: { userId: user.id, title: "Gone", category: "Personal", deletedAt: new Date() } });
  const trashedTask = await prisma.task.create({ data: { userId: user.id, title: "Gone", tags: [], deletedAt: new Date() } });
  // A card with no note at all stays: it belongs to nobody who can be deleted.
  const loose = await prisma.flashcard.create({ data: { userId: user.id, question: "loose?", answer: "loose" } });

  const payload = (await buildFullExport(user.id)) as unknown as Payload;
  const json = JSON.stringify(payload);
  for (const id of [trashed.id, trashedVersion.id, trashedCard.id, trashedFile.id, goneCourse.id, goneAssessment.id, goneChat.id, goneMessage.id, trashedProject.id, trashedGoal.id, trashedTask.id]) {
    assert.ok(!json.includes(id), `${id} is in the file though its parent is deleted`);
  }
  assert.ok(rowsOf(payload, "flashcards").some((card) => card.id === loose.id), "a card with no note stays");

  const ids = (key: string) => new Set(rowsOf(payload, key).map((row) => row.id));
  const notes = ids("notes");
  const courses = ids("courses");
  const conversations = ids("conversations");
  for (const row of rowsOf(payload, "noteVersions")) assert.ok(notes.has(row.noteId as string), "a version's note is exported");
  for (const row of rowsOf(payload, "attachments")) assert.ok(notes.has(row.noteId as string), "an attachment's note is exported");
  for (const row of rowsOf(payload, "flashcards")) assert.ok(row.noteId === null || notes.has(row.noteId as string), "a card's note is exported");
  for (const row of rowsOf(payload, "assessments")) assert.ok(courses.has(row.courseId as string), "an assessment's course is exported");
  for (const row of rowsOf(payload, "messages")) assert.ok(conversations.has(row.conversationId as string), "a message's conversation is exported");
  assert.ok(notes.has(live.note.id) && courses.has(live.course.id) && conversations.has(live.conversation.id), "the live parents are there");
});

test("non-ASCII text, a 100,000-character note, a JSON column and a date survive the trip through JSON", async () => {
  const user = await newUser();
  const unit = "İstanbul 😀 漢字   x"; // Turkish İ, an emoji pair, CJK, a line separator
  const body = unit.repeat(Math.floor(100_000 / unit.length));
  const title = `${unit}`.repeat(5);
  const note = await prisma.note.create({ data: { userId: user.id, title, content: body, tags: ["İ", "😀"] } });
  const conversation = await prisma.conversation.create({ data: { userId: user.id, title: "c" } });
  const citations = [{ index: 1, title: "漢字", nested: { ok: true, n: 2.5, none: null } }];
  await prisma.message.create({ data: { userId: user.id, conversationId: conversation.id, role: "assistant", content: body, citations } });
  const synced = new Date("2026-10-31T08:30:15.123Z");
  await prisma.calendarSubscription.create({ data: { userId: user.id, name: "f", url: "https://example.org/f.ics", lastSyncedAt: synced } });

  const payload = (await buildFullExport(user.id)) as unknown as Payload;
  const back = JSON.parse(JSON.stringify(payload)) as Payload;

  const [exportedNote] = rowsOf(back, "notes");
  assert.equal(exportedNote.id, note.id);
  assert.equal(exportedNote.content, body);
  assert.ok((exportedNote.content as string).length >= 99_990);
  assert.equal(exportedNote.title, title);
  assert.deepEqual(exportedNote.tags, ["İ", "😀"]);
  assert.deepEqual(rowsOf(back, "messages")[0].citations, citations);
  assert.equal(rowsOf(back, "messages")[0].content, body);
  assert.equal(rowsOf(back, "calendarSubscriptions")[0].lastSyncedAt, synced.toISOString());
});

// --- Streaming: the same file, read a page at a time ------------------------------------------------

async function streamed(userId: string, pageSize?: number): Promise<string> {
  let text = "";
  for await (const chunk of streamFullExport(userId, { pageSize })) text += chunk;
  return text;
}

test("the streamed file is valid JSON and the same data as the in-memory one, at any page size", async () => {
  const user = await newUser();
  await populate(user.id, "paged");
  // More rows than one page in the tables that grow. Cards go in one statement, so they share a
  // createdAt to the microsecond: the page boundary must still fall between them without a gap or a repeat.
  for (let i = 0; i < 6; i++) {
    const note = await prisma.note.create({ data: { userId: user.id, title: `Extra ${i}`, content: `extra ${i}`, tags: [] } });
    await prisma.noteVersion.create({ data: { userId: user.id, noteId: note.id, title: `v${i}`, content: `old ${i}` } });
    await prisma.task.create({ data: { userId: user.id, title: `Extra task ${i}`, tags: [] } });
  }
  await prisma.flashcard.createMany({ data: Array.from({ length: 7 }, (_, i) => ({ userId: user.id, question: `Same time ${i}?`, answer: "a" })) });

  const withoutTime = (file: Payload) => {
    const copy = { ...file };
    delete copy.exportedAt;
    return copy;
  };
  const expected = withoutTime(JSON.parse(JSON.stringify(await buildFullExport(user.id))) as Payload);
  for (const pageSize of [1, 2, 3, 1000, undefined]) {
    const file = JSON.parse(await streamed(user.id, pageSize)) as Payload; // throws if it is not valid JSON
    assert.deepEqual(withoutTime(file), expected, `page size ${pageSize}`);
  }

  const file = JSON.parse(await streamed(user.id, 2)) as Payload;
  for (const key of Object.values(EXPORTED_MODELS)) {
    const rows = rowsOf(file, key);
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, `${key}: a row appears twice`);
  }
  assert.ok(rowsOf(file, "notes").length >= 7 && rowsOf(file, "flashcards").length >= 8, "more rows than a page held");
});

test("an empty account streams as valid JSON too, and the file starts with its version", async () => {
  const user = await newUser();
  const text = await streamed(user.id);
  const file = JSON.parse(text) as Payload;
  assert.equal(file.formatVersion, EXPORT_FORMAT_VERSION);
  assert.ok(text.startsWith('{\n"formatVersion": 2,'));
  for (const [model, key] of Object.entries(EXPORTED_MODELS)) {
    assert.deepEqual(file[key], model === "UserProfile" ? null : [], key);
  }
});

test("the streamed file holds the same secrets-free guarantees as the in-memory one", async () => {
  const user = await newUser(SENTINEL.user);
  await populate(user.id, "stream-secret");
  const text = await streamed(user.id, 1);
  for (const secret of Object.values(SENTINEL)) assert.ok(!text.includes(secret), `${secret} leaked into the stream`);
  assert.equal(rowsOf(JSON.parse(text) as Payload, "calendarSubscriptions")[0].host, "cal.example.com");
});

test("stopping a stream early leaves nothing running", async () => {
  const user = await newUser();
  await populate(user.id, "cancel");
  const iterator = streamFullExport(user.id, { pageSize: 1 })[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.deepEqual(await iterator.return?.(undefined), { value: undefined, done: true });
});

// --- Found in the security review ------------------------------------------------------------------

test("asked for nobody, the export is refused before any table is read", async () => {
  const user = await newUser();
  await populate(user.id, "nobody");
  // In a Prisma `where`, `undefined` means "no filter": an export for a missing id would read every
  // account's rows. It is unreachable today (the session always gives a string), and costs nothing to refuse.
  for (const nobody of [undefined, null, "", 42] as unknown as string[]) {
    await assert.rejects(buildFullExport(nobody), (error) => error instanceof AppError && error.code === "VALIDATION_ERROR", `build for ${String(nobody)}`);
    await assert.rejects(streamed(nobody), (error) => error instanceof AppError && error.code === "VALIDATION_ERROR", `stream for ${String(nobody)}`);
  }
  await assert.rejects(streamed("an-id-that-is-nobody"), "an unknown id finds no account");
});

test("a stream cut off at any chunk boundary is never valid JSON, so a partial file cannot pass for a whole one", async () => {
  const user = await newUser();
  await populate(user.id, "cut");
  const chunks: string[] = [];
  for await (const chunk of streamFullExport(user.id, { pageSize: 1 })) chunks.push(chunk);
  assert.ok(chunks.length > 20, "enough chunks to cut");
  JSON.parse(chunks.join("")); // whole: valid
  for (let cut = 1; cut < chunks.length; cut++) {
    assert.throws(() => JSON.parse(chunks.slice(0, cut).join("")), SyntaxError, `cut after ${cut} of ${chunks.length} chunks`);
  }
});

test("more rows than a default page arrive once each in both forms, even when they share a timestamp", async () => {
  const user = await newUser();
  // One statement each, so every row of a table has the same createdAt: only the id can order them.
  const notes = Array.from({ length: 120 }, (_, i) => ({ id: randomUUID(), userId: user.id, title: `Bulk ${i}`, content: `bulk ${i}`, tags: [] as string[] }));
  await prisma.note.createMany({ data: notes }); // 120 is more than two pages of 50
  await prisma.noteVersion.createMany({ data: notes.map((note) => ({ userId: user.id, noteId: note.id, title: "v", content: "old" })) });
  await prisma.task.createMany({ data: Array.from({ length: 1100 }, (_, i) => ({ userId: user.id, title: `Bulk task ${i}`, tags: [] as string[] })) }); // more than a page of 1,000

  const built = JSON.parse(JSON.stringify(await buildFullExport(user.id))) as Payload;
  const streamedFile = JSON.parse(await streamed(user.id)) as Payload;
  for (const [key, count] of [["notes", 120], ["noteVersions", 120], ["tasks", 1100]] as const) {
    for (const [form, file] of [["built", built], ["streamed", streamedFile]] as const) {
      const ids = rowsOf(file, key).map((row) => row.id);
      assert.equal(ids.length, count, `${form} ${key}`);
      assert.equal(new Set(ids).size, count, `${form} ${key}: a row twice`);
    }
  }
});
