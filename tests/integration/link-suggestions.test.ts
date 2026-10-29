/**
 * Link suggestions, unlinked mentions and addLink against a real Postgres, DB-only
 * like the rest of this tier: the vectors are written by hand, so nothing here needs
 * a model. The checks that matter are the ones a pure unit test cannot make: another
 * account's notes never appear, a suggested title opens the note it names, and adding
 * a link goes through the same save as every other edit (a version, a re-index, links).
 *
 * `addLink` saves through noteService.updateNote, which tries to re-embed the note.
 * With Ollama off that logs a warning and drops the note's own vectors, which none of
 * the tests below rely on after the save.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { MAX_NOTE_LENGTH } from "@/lib/see-also";
import { getOutgoingLinks, replaceOutgoingLinks } from "@/repositories/link-repository";
import {
  addLink,
  findMentionsOf,
  MAX_MENTIONS,
  MAX_SUGGESTIONS,
  SUGGESTION_MIN_SIMILARITY,
  suggestLinks,
} from "@/services/link-suggestion-service";

const DIMENSIONS = 768;

const created: string[] = [];
async function newUser(): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: { email: `links-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  created.push(user.id);
  return user;
}

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

type NoteFields = {
  title: string;
  content?: string;
  tags?: string[];
  isFavorite?: boolean;
  projectId?: string | null;
  courseId?: string | null;
  deleted?: boolean;
  updatedAt?: Date;
};

function addNote(userId: string, fields: NoteFields) {
  return prisma.note.create({
    data: {
      userId,
      title: fields.title,
      content: fields.content ?? "",
      tags: fields.tags ?? [],
      isFavorite: fields.isFavorite ?? false,
      projectId: fields.projectId ?? null,
      courseId: fields.courseId ?? null,
      deletedAt: fields.deleted ? new Date() : null,
      ...(fields.updatedAt ? { updatedAt: fields.updatedAt } : {}),
    },
  });
}

/** A unit vector whose cosine similarity to `base` (axis 0) is `similarity`; `axis` keeps notes apart from each other. */
function vectorAt(similarity: number, axis: number): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  vector[0] = similarity;
  vector[axis] = Math.sqrt(1 - similarity * similarity);
  return vector;
}
const BASE = vectorAt(1, 1);

async function putVector(userId: string, noteId: string, vector: number[]) {
  await prisma.$executeRaw`
    INSERT INTO "WorkspaceEmbedding" ("id", "userId", "sourceType", "sourceId", "contentChunk", "embedding")
    VALUES (${randomUUID()}, ${userId}, 'note', ${noteId}, 'chunk', ${`[${vector.join(",")}]`}::vector)`;
}

async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  await assert.rejects(promise, (error) => error instanceof AppError && error.code === code);
}

const near = (actual: number | null | undefined, wanted: number) =>
  actual != null && Math.abs(actual - wanted) < 1e-3;

test("the floor and the caps are the measured ones", () => {
  assert.equal(SUGGESTION_MIN_SIMILARITY, 0.7);
  assert.equal(MAX_SUGGESTIONS, 5);
  assert.equal(MAX_MENTIONS, 5);
});

test("notes close in meaning are suggested above the floor, nearest first, and not below it", async () => {
  const user = await newUser();
  const source = await addNote(user.id, { title: "Gradient descent", content: "About steps." });
  await putVector(user.id, source.id, BASE);
  const wanted: [string, number][] = [
    ["Backpropagation", 0.95],
    ["Regularisation", 0.72],
    ["Weeknight pasta", 0.69],
    ["Packing list", 0.4],
  ];
  for (const [index, [title, similarity]] of wanted.entries()) {
    const note = await addNote(user.id, { title });
    await putVector(user.id, note.id, vectorAt(similarity, 2 + index));
  }

  const suggestions = await suggestLinks(user.id, source.id);

  assert.deepEqual(
    suggestions.map((s) => s.title),
    ["Backpropagation", "Regularisation"],
  );
  assert.deepEqual(suggestions[0].reasons, ["similar"]);
  assert.ok(near(suggestions[0].similarity, 0.95));
  assert.ok(near(suggestions[1].similarity, 0.72));
  assert.equal(suggestions[0].snippet, null);
});

test("at most five are suggested", async () => {
  const user = await newUser();
  const source = await addNote(user.id, { title: "Source note" });
  await putVector(user.id, source.id, BASE);
  for (let index = 0; index < 8; index++) {
    const note = await addNote(user.id, { title: `Close note ${index}` });
    await putVector(user.id, note.id, vectorAt(0.9 - index * 0.01, 2 + index));
  }
  const suggestions = await suggestLinks(user.id, source.id);
  assert.equal(suggestions.length, MAX_SUGGESTIONS);
  assert.deepEqual(suggestions.map((s) => s.title).slice(0, 2), ["Close note 0", "Close note 1"]);
});

test("a note named in this note's text is suggested with no vector at all", async () => {
  const user = await newUser();
  const source = await addNote(user.id, { title: "Study log", content: "I revised gradient descent today." });
  await addNote(user.id, { title: "Gradient descent" });
  await addNote(user.id, { title: "Math" });
  await addNote(user.id, { title: "Weeknight pasta" });

  const suggestions = await suggestLinks(user.id, source.id);

  assert.deepEqual(
    suggestions.map((s) => s.title),
    ["Gradient descent"],
  );
  assert.deepEqual(suggestions[0].reasons, ["named"]);
  assert.equal(suggestions[0].similarity, null);
  assert.ok(suggestions[0].snippet?.includes("gradient descent"));
});

test("a title shorter than five characters is never found in the text, even when it is there", async () => {
  const user = await newUser();
  const source = await addNote(user.id, { title: "Study log", content: "The ML course and the math." });
  await addNote(user.id, { title: "ML" });
  await addNote(user.id, { title: "math" });
  assert.deepEqual(await suggestLinks(user.id, source.id), []);
});

test("a note both named and close appears once, with both reasons, ranked first", async () => {
  const user = await newUser();
  const source = await addNote(user.id, {
    title: "Study log",
    content: "Revised backpropagation and gradient descent.",
  });
  await putVector(user.id, source.id, BASE);
  const backprop = await addNote(user.id, { title: "Backpropagation" });
  await putVector(user.id, backprop.id, vectorAt(0.95, 2));
  await addNote(user.id, { title: "Gradient descent" });
  const regularisation = await addNote(user.id, { title: "Regularisation" });
  await putVector(user.id, regularisation.id, vectorAt(0.9, 3));

  const suggestions = await suggestLinks(user.id, source.id);

  assert.deepEqual(
    suggestions.map((s) => [s.title, s.reasons]),
    [
      ["Backpropagation", ["named", "similar"]],
      ["Gradient descent", ["named"]],
      ["Regularisation", ["similar"]],
    ],
  );
});

test("this note, linked, deleted, bracketed and shared titles are never suggested", async () => {
  const user = await newUser();
  const source = await addNote(user.id, {
    title: "Source note",
    content: "Mentions [[Written link]] in text only.",
  });
  await putVector(user.id, source.id, BASE);
  let axis = 2;
  const similar = async (fields: NoteFields) => {
    const note = await addNote(user.id, fields);
    await putVector(user.id, note.id, vectorAt(0.9, axis++));
    return note;
  };

  const good = await similar({ title: "Good candidate" });
  const linked = await similar({ title: "Linked in the database" });
  await replaceOutgoingLinks(user.id, source.id, [linked.id]);
  await similar({ title: "Written link" });
  await similar({ title: "Deleted note", deleted: true });
  await similar({ title: "Array [0] basics" });
  await similar({ title: "Twin title" });
  await similar({ title: "twin Title" });
  await similar({ title: "Source note" }); // shares the source's own title

  const suggestions = await suggestLinks(user.id, source.id);

  assert.deepEqual(
    suggestions.map((s) => s.id),
    [good.id],
  );
});

test("a title that would not resolve to the note is never suggested", async () => {
  const user = await newUser();
  const source = await addNote(user.id, { title: "Source note" });
  await putVector(user.id, source.id, BASE);
  const trailing = await addNote(user.id, { title: "Trailing space " });
  await putVector(user.id, trailing.id, vectorAt(0.9, 2));
  assert.deepEqual(await suggestLinks(user.id, source.id), []);
});

test("another account's notes are never suggested, named or mentioned, and never make a title look shared", async () => {
  const mine = await newUser();
  const other = await newUser();
  const source = await addNote(mine.id, {
    title: "Study log",
    content: "I revised gradient descent today.",
  });
  await putVector(mine.id, source.id, BASE);
  const mineTarget = await addNote(mine.id, { title: "Gradient descent" });
  const mineMentioner = await addNote(mine.id, { title: "Weekly review", content: "Reread my study log." });
  const theirs = await addNote(other.id, {
    title: "Gradient descent",
    content: "Study log mentioned here.",
  });
  await putVector(other.id, theirs.id, BASE); // as close as a note can be
  const theirTwin = await addNote(other.id, { title: "Study log", content: "Study log" });
  await putVector(other.id, theirTwin.id, BASE);

  // Their notes with the same titles as mine neither appear nor make mine ambiguous.
  assert.deepEqual(
    (await suggestLinks(mine.id, source.id)).map((s) => s.id),
    [mineTarget.id],
  );
  assert.deepEqual(
    (await findMentionsOf(mine.id, source.id)).map((m) => m.id),
    [mineMentioner.id],
  );

  // Their note ids, asked for by me, are the same as notes that do not exist.
  assert.deepEqual(await suggestLinks(mine.id, theirs.id), []);
  assert.deepEqual(await findMentionsOf(mine.id, theirs.id), []);
  await expectCode(addLink(mine.id, source.id, theirs.id), "RESOURCE_NOT_FOUND");
  await expectCode(addLink(mine.id, theirs.id, source.id), "RESOURCE_NOT_FOUND");
  const after = await prisma.note.findUniqueOrThrow({ where: { id: theirs.id } });
  assert.equal(after.content, "Study log mentioned here.");
});

test("missing vectors leave the named suggestions, and an orphan vector is ignored", async () => {
  const user = await newUser();
  const source = await addNote(user.id, { title: "Study log", content: "See gradient descent." });
  await addNote(user.id, { title: "Gradient descent" });
  // The source has no vectors. A vector for a note that does not exist is skipped.
  await putVector(user.id, randomUUID(), BASE);

  const suggestions = await suggestLinks(user.id, source.id);

  assert.deepEqual(
    suggestions.map((s) => s.title),
    ["Gradient descent"],
  );
});

test("unlinked mentions: a plain mention counts; code, an existing link, a longer link, a deleted note and a note that already links here do not", async () => {
  const user = await newUser();
  const target = await addNote(user.id, { title: "Gradient descent" });
  const plain = await addNote(user.id, { title: "Plain", content: "I revised gradient descent today." });
  await addNote(user.id, { title: "In code", content: "```\ngradient descent\n```" });
  await addNote(user.id, { title: "In a longer link", content: "See [[Gradient descent intro]]." });
  const linking = await addNote(user.id, {
    title: "Links here",
    content: "See [[Gradient descent]] and gradient descent again.",
  });
  await replaceOutgoingLinks(user.id, linking.id, [target.id]);
  // Listed under "Linked from" by its link row, though its text only says the words.
  const rowOnly = await addNote(user.id, { title: "Row only", content: "gradient descent in plain words" });
  await replaceOutgoingLinks(user.id, rowOnly.id, [target.id]);
  await addNote(user.id, { title: "Deleted", content: "gradient descent", deleted: true });
  await addNote(user.id, { title: "Unrelated", content: "Cooking pasta." });

  const mentions = await findMentionsOf(user.id, target.id);

  assert.deepEqual(
    mentions.map((m) => m.id),
    [plain.id],
  );
  assert.deepEqual(mentions[0].reasons, ["named"]);
  assert.equal(mentions[0].similarity, null);
  assert.ok(mentions[0].snippet?.includes("gradient descent"));
});

test("a note whose text holds the link but whose link rows are not synced is not offered either", async () => {
  const user = await newUser();
  const target = await addNote(user.id, { title: "Gradient descent" });
  await addNote(user.id, { title: "Text only", content: "[[gradient   DESCENT]] and gradient descent" });
  assert.deepEqual(await findMentionsOf(user.id, target.id), []);
});

test("mentions are capped at five, most recently edited first", async () => {
  const user = await newUser();
  const target = await addNote(user.id, { title: "Gradient descent" });
  for (let index = 0; index < 8; index++) {
    await addNote(user.id, {
      title: `Mentioner ${index}`,
      content: "gradient descent",
      updatedAt: new Date(Date.UTC(2026, 0, 1 + index)),
    });
  }
  const mentions = await findMentionsOf(user.id, target.id);
  assert.deepEqual(
    mentions.map((m) => m.title),
    ["Mentioner 7", "Mentioner 6", "Mentioner 5", "Mentioner 4", "Mentioner 3"],
  );
});

test("punctuation in a title is matched literally, wildcard characters included", async () => {
  const user = await newUser();
  const percent = await addNote(user.id, { title: "50% rule" });
  const underscore = await addNote(user.id, { title: "snake_case rules" });
  const wanted = await addNote(user.id, {
    title: "Mentions both",
    content: "Read the 50% rule and the snake_case rules.",
  });
  await addNote(user.id, { title: "Lookalike", content: "50x rule and snakeXcase rules" });

  assert.deepEqual((await findMentionsOf(user.id, percent.id)).map((m) => m.id), [wanted.id]);
  assert.deepEqual((await findMentionsOf(user.id, underscore.id)).map((m) => m.id), [wanted.id]);
});

test("mentions are not offered for a title that is short, bracketed, shared or would not resolve", async () => {
  const user = await newUser();
  await addNote(user.id, { title: "Mentioner", content: "ML and Array [0] basics and Twin title and Trailing space." });
  const short = await addNote(user.id, { title: "ML" });
  const bracketed = await addNote(user.id, { title: "Array [0] basics" });
  const twinA = await addNote(user.id, { title: "Twin title" });
  await addNote(user.id, { title: "Twin title" });
  const trailing = await addNote(user.id, { title: "Trailing space " });

  for (const note of [short, bracketed, twinA, trailing]) {
    assert.deepEqual(await findMentionsOf(user.id, note.id), [], note.title);
  }
});

test("addLink appends a bullet under See also, saves a version, syncs the link and keeps every other field", async () => {
  const user = await newUser();
  const course = await prisma.course.create({
    data: { userId: user.id, code: "CMP1000", title: "Course", term: "2026" },
  });
  const project = await prisma.project.create({
    data: { userId: user.id, title: "Project", category: "University" },
  });
  const from = await addNote(user.id, {
    title: "Study log",
    content: "Intro.\n",
    tags: ["a", "b"],
    isFavorite: true,
    courseId: course.id,
    projectId: project.id,
    updatedAt: new Date(Date.UTC(2026, 0, 1)),
  });
  const to = await addNote(user.id, { title: "Gradient descent" });

  const result = await addLink(user.id, from.id, to.id);

  assert.deepEqual(result, { added: true, fromTitle: "Study log", toTitle: "Gradient descent" });
  const saved = await prisma.note.findUniqueOrThrow({ where: { id: from.id } });
  assert.equal(saved.content, "Intro.\n\n## See also\n\n- [[Gradient descent]]\n");
  assert.equal(saved.title, "Study log");
  assert.deepEqual(saved.tags, ["a", "b"]);
  assert.equal(saved.isFavorite, true);
  assert.equal(saved.courseId, course.id);
  assert.equal(saved.projectId, project.id);
  assert.ok(saved.updatedAt.getTime() > Date.UTC(2026, 0, 2));
  assert.deepEqual(
    (await getOutgoingLinks(user.id, from.id)).map((n) => n.id),
    [to.id],
  );
  const versions = await prisma.noteVersion.findMany({ where: { noteId: from.id } });
  assert.equal(versions.length, 1);
  assert.equal(versions[0].content, "Intro.\n");
});

test("adding the same link twice adds one bullet and one version", async () => {
  const user = await newUser();
  const from = await addNote(user.id, { title: "Study log", content: "Intro.\n" });
  const to = await addNote(user.id, { title: "Gradient descent" });

  await addLink(user.id, from.id, to.id);
  const once = await prisma.note.findUniqueOrThrow({ where: { id: from.id } });
  const again = await addLink(user.id, from.id, to.id);

  assert.equal(again.added, false);
  const twice = await prisma.note.findUniqueOrThrow({ where: { id: from.id } });
  assert.equal(twice.content, once.content);
  assert.equal(await prisma.noteVersion.count({ where: { noteId: from.id } }), 1);
});

test("a link added from the mentions side lands in the other note", async () => {
  const user = await newUser();
  const target = await addNote(user.id, { title: "Gradient descent" });
  const mentioner = await addNote(user.id, { title: "Study log", content: "I revised gradient descent." });

  const [mention] = await findMentionsOf(user.id, target.id);
  await addLink(user.id, mention.id, target.id);

  const saved = await prisma.note.findUniqueOrThrow({ where: { id: mentioner.id } });
  assert.ok(saved.content.endsWith("## See also\n\n- [[Gradient descent]]\n"));
  assert.deepEqual(await findMentionsOf(user.id, target.id), []);
});

test("addLink refuses what cannot be written as a link that opens the target", async () => {
  const user = await newUser();
  const from = await addNote(user.id, { title: "Study log", content: "Intro.\n" });
  const bracketed = await addNote(user.id, { title: "Array [0] basics" });
  const olderTwin = await addNote(user.id, { title: "Twin title", updatedAt: new Date(Date.UTC(2026, 0, 1)) });
  const newerTwin = await addNote(user.id, { title: "Twin title", updatedAt: new Date(Date.UTC(2026, 0, 2)) });
  const trailing = await addNote(user.id, { title: "Trailing space " });
  const sameAsSource = await addNote(user.id, { title: "Study log" });

  await expectCode(addLink(user.id, from.id, from.id), "VALIDATION_ERROR");
  for (const target of [bracketed, olderTwin, newerTwin, trailing, sameAsSource]) {
    await expectCode(addLink(user.id, from.id, target.id), "VALIDATION_ERROR");
  }
  const unchanged = await prisma.note.findUniqueOrThrow({ where: { id: from.id } });
  assert.equal(unchanged.content, "Intro.\n");
  assert.equal(await prisma.noteVersion.count({ where: { noteId: from.id } }), 0);
});

test("addLink refuses a note too long to take another line", async () => {
  const user = await newUser();
  const content = "x".repeat(MAX_NOTE_LENGTH - 5);
  const from = await addNote(user.id, { title: "Long note", content });
  const to = await addNote(user.id, { title: "Gradient descent" });

  await expectCode(addLink(user.id, from.id, to.id), "VALIDATION_ERROR");

  const unchanged = await prisma.note.findUniqueOrThrow({ where: { id: from.id } });
  assert.equal(unchanged.content, content);
});

test("addLink refuses a note that already holds the fifty links the index follows", async () => {
  const user = await newUser();
  const content = Array.from({ length: 50 }, (_, index) => `[[Link ${index}]]`).join(" ");
  const from = await addNote(user.id, { title: "Hub", content });
  const to = await addNote(user.id, { title: "Gradient descent" });

  await expectCode(addLink(user.id, from.id, to.id), "VALIDATION_ERROR");
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: from.id } })).content, content);
});

test("a deleted note is not found on either side", async () => {
  const user = await newUser();
  const live = await addNote(user.id, { title: "Live note" });
  const gone = await addNote(user.id, { title: "Gone note", deleted: true });
  await expectCode(addLink(user.id, live.id, gone.id), "RESOURCE_NOT_FOUND");
  await expectCode(addLink(user.id, gone.id, live.id), "RESOURCE_NOT_FOUND");
  await expectCode(addLink(user.id, live.id, randomUUID()), "RESOURCE_NOT_FOUND");
  assert.deepEqual(await suggestLinks(user.id, gone.id), []);
  assert.deepEqual(await findMentionsOf(user.id, gone.id), []);
});

test("a deleted note with the same title does not make a title ambiguous", async () => {
  const user = await newUser();
  const from = await addNote(user.id, { title: "Study log", content: "Intro.\n" });
  await putVector(user.id, from.id, BASE);
  const to = await addNote(user.id, { title: "Reused title" });
  await putVector(user.id, to.id, vectorAt(0.9, 2));
  await addNote(user.id, { title: "Reused title", deleted: true });
  const mentioner = await addNote(user.id, { title: "Mentioner", content: "Read the reused title again." });

  assert.deepEqual(
    (await suggestLinks(user.id, from.id)).map((s) => s.id),
    [to.id],
  );
  assert.deepEqual(
    (await findMentionsOf(user.id, to.id)).map((m) => m.id),
    [mentioner.id],
  );
  assert.equal((await addLink(user.id, from.id, to.id)).added, true);
});
