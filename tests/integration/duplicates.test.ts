/**
 * Duplicate-note cleanup (ROADMAP item 36), against a real Postgres. Stored vectors are written directly with exact cosines
 * (no model), so what is offered follows from numbers the test chose. Most tests are about what must NOT happen: another
 * account's notes offered or changed, the trash offered, a merge made on a note that changed, or a loss of text or links.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { EMBEDDING_DIMENSIONS } from "@/lib/config";
import { keepBoth, listDuplicates, mergeNotes } from "@/services/duplicate-service";
import { decidedKeys, moveChildren, referrersOf, sameTextGroups, vectorPairs } from "@/repositories/duplicate-repository";
import { getBacklinks } from "@/repositories/link-repository";

const made: string[] = [];
async function newUser(): Promise<string> {
  const user = await prisma.user.create({ data: { email: `dups-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

let nextAxis = 10;
/** Two orthogonal-to-everything-else unit vectors whose cosine to each other is `similarity`. */
function pairVectors(similarity: number): [number[], number[]] {
  const axis = nextAxis;
  nextAxis += 2;
  const a = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const b = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  a[axis] = 1;
  b[axis] = similarity;
  b[axis + 1] = Math.sqrt(1 - similarity * similarity);
  return [a, b];
}
async function putVector(userId: string, noteId: string, vector: number[]) {
  await prisma.$executeRaw`
    INSERT INTO "WorkspaceEmbedding" ("id", "userId", "sourceType", "sourceId", "contentChunk", "embedding")
    VALUES (${randomUUID()}, ${userId}, 'note', ${noteId}, 'chunk', ${`[${vector.join(",")}]`}::vector)`;
}
const note = (userId: string, title: string, content: string, extra: Record<string, unknown> = {}) =>
  prisma.note.create({ data: { userId, title, content, tags: [], ...extra } });

const TEXT = "Gradient descent minimises a loss function by repeatedly stepping in the direction of the negative gradient. The learning rate sets the step size.";
const REWORDED = "To train a model you reduce its loss by moving the parameters a little downhill, which is minus the gradient, and how far you move is the learning rate.";

test("copies and rewordings are offered for what they are; a different note in the same field, or a pair too far apart, is not", async () => {
  const me = await newUser();
  const a = await note(me, "Gradient descent", TEXT);
  const b = await note(me, "Gradient descent (copy)", `${TEXT} Momentum smooths the path.`);
  const c = await note(me, "How training works", REWORDED);
  const d = await note(me, "Gradient descent, again", TEXT.replace("minimises", "reduces").replace("repeatedly", "over and over"));
  const e = await note(me, "Backpropagation", "Backpropagation applies the chain rule layer by layer from the output back to the input.");
  const f = await note(me, "Cellular respiration", "Cellular respiration releases the energy in glucose as ATP in the mitochondria.");
  const [av, bv] = pairVectors(0.97);
  await putVector(me, a.id, av);
  await putVector(me, b.id, bv);
  const [cv, dv] = pairVectors(0.89);
  await putVector(me, c.id, cv);
  await putVector(me, d.id, dv);
  const [ev, fv] = pairVectors(0.8);
  await putVector(me, e.id, ev);
  await putVector(me, f.id, fv);

  const { pairs, searchedByMeaning } = await listDuplicates(me);
  assert.equal(searchedByMeaning, true);
  const titles = (pair: (typeof pairs)[number]) => [pair.a.title, pair.b.title].sort().join(" | ");
  assert.deepEqual(pairs.map(titles).sort(), [["Gradient descent", "Gradient descent (copy)"].sort().join(" | "), ["Gradient descent, again", "How training works"].sort().join(" | ")].sort(), "the 0.80 pair is not offered");

  const copy = pairs.find((pair) => titles(pair).includes("(copy)"))!;
  assert.equal(copy.kind, "same-text");
  assert.ok(Math.abs((copy.similarity ?? 0) - 0.97) < 0.001);
  assert.equal(copy.suggestedKeepId, b.id, "the longer note is suggested");
  const lacks = new Map([[copy.a.id, copy.aLacks], [copy.b.id, copy.bLacks]]);
  assert.equal(lacks.get(b.id), 0, "keeping the longer note adds nothing");
  assert.equal(lacks.get(a.id), 1, "keeping the shorter would add the extra sentence");

  const reworded = pairs.find((pair) => titles(pair).includes("How training works"))!;
  assert.equal(reworded.kind, "same-ideas", "close in meaning, different words");
  assert.ok(Math.abs((reworded.similarity ?? 0) - 0.89) < 0.001);
  assert.ok(pairs.indexOf(copy) < pairs.indexOf(reworded), "copies come first");
});

test("the average of a note's chunks decides, not its single best chunk", async () => {
  const me = await newUser();
  const a = await note(me, "One", TEXT);
  const b = await note(me, "Two", TEXT);
  // `b` has one chunk identical to `a`'s and one about something else entirely: the mean is 0.71 alike, the best chunk 1.0.
  const [av] = pairVectors(1);
  const same = [...av];
  const elsewhere = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  elsewhere[400] = 1;
  await putVector(me, a.id, av);
  await putVector(me, b.id, same);
  await putVector(me, b.id, elsewhere);
  const found = await vectorPairs(me, 0.88, 50);
  assert.equal(found.length, 0, "a note that merely contains a paragraph about the same thing is not a duplicate by meaning");
  // Identical text is still found, without any vector.
  assert.equal((await sameTextGroups(me)).length, 1);
  const { pairs } = await listDuplicates(me);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].similarity, null);
  assert.equal(pairs[0].kind, "same-text");
});

test("only the caller's live notes are compared: another account's pair, the trash and orphaned vectors are never offered", async () => {
  const me = await newUser();
  const other = await newUser();
  const mine = await note(me, "Mine", TEXT);
  const gone = await note(me, "Gone", TEXT, { deletedAt: new Date() });
  const theirsA = await note(other, "Theirs A", TEXT);
  const theirsB = await note(other, "Theirs B", TEXT);
  const [v1, v2] = pairVectors(0.99);
  await putVector(me, mine.id, v1);
  await putVector(me, gone.id, v2);
  const [w1, w2] = pairVectors(0.99);
  await putVector(other, theirsA.id, w1);
  await putVector(other, theirsB.id, w2);
  // A vector row for a note of mine that is stored under the other account (a stale or forged row) makes no pair for me.
  const [x1, x2] = pairVectors(0.99);
  const stray = await note(other, "Stray", "A note of the other account that says something else entirely.");
  await putVector(me, stray.id, x1);
  await putVector(me, mine.id, x2);
  const overview = await listDuplicates(me);
  assert.deepEqual(overview.pairs, []);
  assert.equal((await listDuplicates(other)).pairs.length, 1, "the other account sees its own pair");
});

test("keep both hides the pair for good, in either order, and only for two live notes of the caller", async () => {
  const me = await newUser();
  const other = await newUser();
  const a = await note(me, "A", TEXT);
  const b = await note(me, "B", TEXT);
  const foreign = await note(other, "Foreign", TEXT);
  const trashed = await note(me, "Trashed", TEXT, { deletedAt: new Date() });
  assert.equal((await listDuplicates(me)).pairs.length, 1);
  await keepBoth(me, { a: b.id, b: a.id });
  await keepBoth(me, { a: a.id, b: b.id });
  assert.equal(await prisma.duplicateDecision.count({ where: { userId: me } }), 1, "one row for the pair, whichever way it is named");
  assert.equal((await listDuplicates(me)).pairs.length, 0);
  for (const bad of [{ a: a.id, b: foreign.id }, { a: a.id, b: trashed.id }, { a: a.id, b: randomUUID() }]) {
    await assert.rejects(() => keepBoth(me, bad), (error: { code?: string; message?: string }) => error.code === "RESOURCE_NOT_FOUND" && error.message === "One of those notes no longer exists.");
  }
  await assert.rejects(() => keepBoth(me, { a: a.id, b: a.id }), { code: "VALIDATION_ERROR" });
  await assert.rejects(() => keepBoth(me, { a: "nope", b: a.id }), { code: "VALIDATION_ERROR" });
  await assert.rejects(() => keepBoth("", { a: a.id, b: b.id }), { code: "AUTH_REQUIRED" });
  assert.equal(await prisma.duplicateDecision.count({ where: { userId: other } }), 0);
  // Deleting a note for good deletes the decision about it.
  await prisma.note.delete({ where: { id: b.id } });
  assert.equal(await prisma.duplicateDecision.count({ where: { userId: me } }), 0);
});

const stamp = (n: { updatedAt: Date }) => n.updatedAt.getTime();
const input = (keep: { id: string; updatedAt: Date }, drop: { id: string; updatedAt: Date }) => ({ keepId: keep.id, dropId: drop.id, keepUpdatedAt: stamp(keep), dropUpdatedAt: stamp(drop) });

test("a merge keeps one note, adds what only the other says, moves what pointed at it, and trashes it last", async () => {
  const me = await newUser();
  const project = await prisma.project.create({ data: { userId: me, title: "Thesis", category: "University" } });
  const keep = await note(me, "Gradient descent", "Shared paragraph.\n\nOnly in keep.", { tags: ["ml"] });
  const drop = await note(me, "Gradient descent (old)", "Shared paragraph.\n\nOnly in drop.", { tags: ["ml", "draft"], isFavorite: true, projectId: project.id });
  const referrer = await note(me, "Index", "Start with [[Gradient descent (old)]] and `[[Gradient descent (old)]]`.");
  const task = await prisma.task.create({ data: { userId: me, title: "Revise", noteId: drop.id, status: "todo", priority: "low", tags: [] } });
  const card = await prisma.flashcard.create({ data: { userId: me, noteId: drop.id, question: "Q", answer: "A" } });
  const file = await prisma.attachment.create({ data: { userId: me, noteId: drop.id, filename: "a.png", mimeType: "image/png", byteSize: 3, storageKey: `k-${randomUUID()}` } });
  await prisma.entityLink.create({ data: { userId: me, sourceType: "note", sourceId: referrer.id, targetType: "note", targetId: drop.id } });

  const result = await mergeNotes(me, input(keep, drop));
  assert.deepEqual(result, { addedBlocks: 1, linksRewritten: 1, tasks: 1, cards: 1, attachments: 1 });

  const after = await prisma.note.findUniqueOrThrow({ where: { id: keep.id } });
  assert.ok(after.content.startsWith("Shared paragraph.\n\nOnly in keep."), "the kept text is untouched, at the start");
  assert.ok(after.content.includes("## Merged from Gradient descent (old)\n\nOnly in drop."));
  assert.deepEqual(after.tags, ["ml", "draft"]);
  assert.equal(after.isFavorite, true);
  assert.equal(after.projectId, project.id);
  assert.equal(await prisma.noteVersion.count({ where: { noteId: keep.id } }), 1, "a version of the kept note's old text exists, so History undoes it");
  assert.ok((await prisma.note.findUniqueOrThrow({ where: { id: drop.id } })).deletedAt, "the other note is in the trash, not gone");
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).noteId, keep.id);
  assert.equal((await prisma.flashcard.findUniqueOrThrow({ where: { id: card.id } })).noteId, keep.id);
  assert.equal((await prisma.attachment.findUniqueOrThrow({ where: { id: file.id } })).noteId, keep.id);
  const linked = await prisma.note.findUniqueOrThrow({ where: { id: referrer.id } });
  assert.equal(linked.content, "Start with [[Gradient descent]] and `[[Gradient descent (old)]]`.", "a link is rewritten, code about a link is not");
  assert.equal(await prisma.noteVersion.count({ where: { noteId: referrer.id } }), 1);
  assert.deepEqual((await getBacklinks(me, keep.id)).map((n) => n.id), [referrer.id], "the stored link points at the kept note");
  assert.equal((await getBacklinks(me, drop.id)).length, 0);
  // It cannot be done twice: the other note is in the trash now.
  await assert.rejects(() => mergeNotes(me, input(keep, drop)), { code: "RESOURCE_NOT_FOUND" });
});

test("two notes with one title: links to either now resolve to the kept note", async () => {
  const me = await newUser();
  const keep = await note(me, "Same title", "Body.", { updatedAt: new Date("2026-01-01") });
  const drop = await note(me, "same  TITLE", "Body.", { updatedAt: new Date("2026-02-01") });
  const referrer = await note(me, "Index", "See [[Same title]].");
  await prisma.entityLink.create({ data: { userId: me, sourceType: "note", sourceId: referrer.id, targetType: "note", targetId: drop.id } });
  const result = await mergeNotes(me, input(keep, drop));
  assert.equal(result.linksRewritten, 0, "there is nothing to rewrite when the title is one title");
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: referrer.id } })).content, "See [[Same title]].");
  assert.deepEqual((await getBacklinks(me, keep.id)).map((n) => n.id), [referrer.id]);
});

test("a note that links to the one being merged is written once, not overwritten from an old read", async () => {
  const me = await newUser();
  const keep = await note(me, "Keep", "My text, and a link to [[Drop]].");
  const drop = await note(me, "Drop", "Their text.");
  await mergeNotes(me, input(keep, drop));
  const after = await prisma.note.findUniqueOrThrow({ where: { id: keep.id } });
  assert.equal(after.content, "My text, and a link to [[Keep]].\n\n## Merged from Drop\n\nTheir text.\n");
});

test("a note that changed since it was shown is not merged, and nothing is written", async () => {
  const me = await newUser();
  const keep = await note(me, "Keep", "Alpha.");
  const drop = await note(me, "Drop", "Beta.");
  await prisma.note.update({ where: { id: drop.id }, data: { content: "Beta, edited." } });
  await assert.rejects(() => mergeNotes(me, input(keep, drop)), { code: "VALIDATION_ERROR", message: /changed since/ });
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: keep.id } })).content, "Alpha.");
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: drop.id } })).deletedAt, null);
});

test("another account's notes cannot be merged, moved or rewritten, however they are named", async () => {
  const me = await newUser();
  const other = await newUser();
  const mine = await note(me, "Mine", "Text.");
  const theirs = await note(other, "Theirs", "Their text.");
  const theirReferrer = await note(other, "Their index", "See [[Theirs]] and [[Mine]].");
  const theirTask = await prisma.task.create({ data: { userId: other, title: "T", noteId: theirs.id, status: "todo", priority: "low", tags: [] } });
  const before = await prisma.note.findMany({ where: { userId: other }, orderBy: { id: "asc" } });
  for (const attempt of [input(mine, theirs), input(theirs, mine)]) {
    await assert.rejects(() => mergeNotes(me, attempt), (error: { code?: string; message?: string }) => error.code === "RESOURCE_NOT_FOUND" && error.message === "One of those notes no longer exists.");
  }
  // A note of mine that other people's text mentions by title is merged without touching their text.
  const twin = await note(me, "Twin", "Text.");
  await mergeNotes(me, input(mine, twin));
  assert.deepEqual(await prisma.note.findMany({ where: { userId: other }, orderBy: { id: "asc" } }), before);
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: theirTask.id } })).noteId, theirs.id);
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: theirReferrer.id } })).content, "See [[Theirs]] and [[Mine]].");
  for (const bad of [{ keepId: "x", dropId: mine.id, keepUpdatedAt: 1, dropUpdatedAt: 1 }, { ...input(mine, mine) }, { keepId: mine.id }, null]) {
    await assert.rejects(() => mergeNotes(me, bad), (error: { code?: string }) => error.code === "VALIDATION_ERROR");
  }
  await assert.rejects(() => mergeNotes("", input(mine, mine)), { code: "AUTH_REQUIRED" });
});

test("a merge that would not fit in one note is refused with nothing changed", async () => {
  const me = await newUser();
  const keep = await note(me, "Keep", "alpha ".repeat(15_000));
  const drop = await note(me, "Drop", "beta gamma ".repeat(9_000));
  await assert.rejects(() => mergeNotes(me, input(keep, drop)), { code: "VALIDATION_ERROR", message: /longer than one note/ });
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: drop.id } })).deletedAt, null);
  assert.equal(await prisma.noteVersion.count({ where: { noteId: keep.id } }), 0);
});

test("each reader and writer is scoped to the caller on its own, not only through the service", async () => {
  const me = await newUser();
  const other = await newUser();
  const mine = await note(me, "Mine", TEXT);
  const twin = await note(me, "Twin", TEXT);
  const theirs = await note(other, "Theirs", TEXT);
  const theirsToo = await note(other, "Theirs too", TEXT);
  // A vector row of the other account that names one of my notes, beside one of mine: it must not make a pair for me.
  const [v1, v2] = pairVectors(0.99);
  await putVector(me, mine.id, v1);
  await putVector(other, twin.id, v2);
  assert.deepEqual(await vectorPairs(me, 0.88, 50), []);
  // Same text groups: mine and the other account's are separate groups.
  const groups = await sameTextGroups(me);
  assert.deepEqual(groups.map((ids) => [...ids].sort()), [[mine.id, twin.id].sort()]);
  // Another account's decision about two of its notes is not mine.
  await prisma.duplicateDecision.create({ data: { userId: other, noteAId: theirs.id < theirsToo.id ? theirs.id : theirsToo.id, noteBId: theirs.id < theirsToo.id ? theirsToo.id : theirs.id } });
  assert.equal((await decidedKeys(me)).size, 0);
  // Moving what points at a note moves only the caller's own rows, even when another account's row names the same note.
  const theirTask = await prisma.task.create({ data: { userId: other, title: "T", noteId: mine.id, status: "todo", priority: "low", tags: [] } });
  const theirCard = await prisma.flashcard.create({ data: { userId: other, noteId: mine.id, question: "Q", answer: "A" } });
  const theirFile = await prisma.attachment.create({ data: { userId: other, noteId: mine.id, filename: "a.png", mimeType: "image/png", byteSize: 1, storageKey: `k-${randomUUID()}` } });
  assert.deepEqual(await moveChildren(me, mine.id, twin.id), { tasks: 0, cards: 0, attachments: 0 });
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: theirTask.id } })).noteId, mine.id);
  assert.equal((await prisma.flashcard.findUniqueOrThrow({ where: { id: theirCard.id } })).noteId, mine.id);
  assert.equal((await prisma.attachment.findUniqueOrThrow({ where: { id: theirFile.id } })).noteId, mine.id);
  // Notes that link to mine: another account's note that writes the same title, or has a stored link to it, is not a referrer of mine.
  const stranger = await note(other, "Stranger", "See [[Mine]].");
  await prisma.entityLink.create({ data: { userId: other, sourceType: "note", sourceId: stranger.id, targetType: "note", targetId: mine.id } });
  const trashedLinker = await note(me, "Trashed linker", "See [[Mine]].", { deletedAt: new Date() });
  const real = await note(me, "Real linker", "See [[Mine]].");
  assert.deepEqual((await referrersOf(me, mine.id, "Mine", 50)).map((n) => n.id), [real.id]);
  assert.ok(trashedLinker.id);
});

test("the readers leave out the trash, other accounts' notes, short notes and tell identical text apart from different text", async () => {
  const me = await newUser();
  const other = await newUser();
  const live = await note(me, "Live", TEXT);
  const trashed = await note(me, "Trashed", TEXT, { deletedAt: new Date() });
  const foreign = await note(other, "Foreign", TEXT);
  const [v1, v2] = pairVectors(0.99);
  await putVector(me, live.id, v1);
  await putVector(me, trashed.id, v2);
  const [x1, x2] = pairVectors(0.99);
  await putVector(me, live.id, x1);
  await putVector(me, foreign.id, x2);
  assert.deepEqual(await vectorPairs(me, 0.5, 50), [], "a trashed or foreign note's vectors never make a pair");
  assert.deepEqual(await sameTextGroups(me), [], "a trashed or foreign copy is no group");
  await note(me, "Short 1", "tiny note");
  await note(me, "Short 2", "tiny note");
  assert.deepEqual(await sameTextGroups(me), [], "two notes under 20 characters are not a duplicate");
  await note(me, "Spaced", "Alpha   BETA gamma, delta; epsilon zeta eta theta");
  await note(me, "Plain", "alpha beta gamma delta epsilon zeta eta theta!");
  await note(me, "Different", "alpha beta gamma delta epsilon zeta eta iota!");
  const groups = await sameTextGroups(me);
  assert.equal(groups.length, 1, "case, spacing and punctuation do not make the text different, a changed word does");
  assert.equal(groups[0].length, 2);
});

test("a star or a project alone is carried to the kept note, even when the text and tags add nothing", async () => {
  const me = await newUser();
  const project = await prisma.project.create({ data: { userId: me, title: "P", category: "Personal" } });
  const course = await prisma.course.create({ data: { userId: me, code: "C1", title: "C", term: "T" } });
  const plain = await note(me, "Plain", "Same words here.");
  const starred = await note(me, "Starred", "Same words here.", { isFavorite: true });
  await mergeNotes(me, input(plain, starred));
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: plain.id } })).isFavorite, true);
  const bare = await note(me, "Bare", "Other words there.");
  const placed = await note(me, "Placed", "Other words there.", { projectId: project.id });
  await mergeNotes(me, input(bare, placed));
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: bare.id } })).projectId, project.id);
  const noCourse = await note(me, "No course", "Third words.");
  const inCourse = await note(me, "In course", "Third words.", { courseId: course.id });
  await mergeNotes(me, input(noCourse, inCourse));
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: noCourse.id } })).courseId, course.id);
});

test("renaming the links cannot push the kept note past the limit, and too many linking notes are refused before anything is written", async () => {
  const me = await newUser();
  const longTitle = "L".repeat(190);
  const keep = await note(me, longTitle, `${"word ".repeat(19_000)}[[Drop]] ${"[[Drop]] ".repeat(400)}`);
  const drop = await note(me, "Drop", "Short.");
  await assert.rejects(() => mergeNotes(me, input(keep, drop)), { code: "VALIDATION_ERROR", message: /longer than one note/ });
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: drop.id } })).deletedAt, null);

  const keep2 = await note(me, "Keep2", "Alpha.");
  const drop2 = await note(me, "Drop2", "Beta.");
  await prisma.note.createMany({ data: Array.from({ length: 500 }, (_, index) => ({ userId: me, title: `Linker ${index}`, content: "See [[Drop2]].", tags: [] })) });
  await assert.rejects(() => mergeNotes(me, input(keep2, drop2)), { code: "VALIDATION_ERROR", message: /Too many notes link/ });
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: keep2.id } })).content, "Alpha.");
  assert.equal(await prisma.noteVersion.count({ where: { noteId: keep2.id } }), 0);
});
