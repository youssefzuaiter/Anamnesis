/**
 * The reading state of a reference (ROADMAP item 43) against a real Postgres: set only by its owner, validated before anything is written,
 * kept when the reference is edited, counted per citing note, and carried by the export and a restore.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import * as refs from "@/services/reference-service";
import { noteTextsWithAt } from "@/repositories/reference-repository";

const made: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `read-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

const ref = (userId: string, key = "vaswani2017") => refs.createReference(userId, { key, type: "article", title: "Attention is all you need", authors: [{ family: "Vaswani", given: "A." }], year: 2017 });
const note = (userId: string, content: string, over: { deletedAt?: Date | null; title?: string } = {}) =>
  prisma.note.create({ data: { userId, title: over.title ?? "N", content, tags: [], deletedAt: over.deletedAt ?? null } });
const refusedAs = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;

test("a new reference is to read with no takeaway, and setting it changes only those two fields", async () => {
  const me = await newUser();
  const r = await ref(me);
  assert.equal(r.readStatus, "to_read");
  assert.equal(r.takeaway, null);
  const saved = await refs.setReading(me, r.id, { status: "reading", takeaway: "  Self-attention\nreplaces recurrence  " });
  assert.equal(saved.readStatus, "reading");
  assert.equal(saved.takeaway, "Self-attention replaces recurrence");
  assert.equal(saved.title, r.title);
  assert.equal(saved.key, r.key);
  assert.deepEqual(saved.authors, r.authors);
  const cleared = await refs.setReading(me, r.id, { status: "done", takeaway: "   " });
  assert.deepEqual([cleared.readStatus, cleared.takeaway], ["done", null]);
});

test("editing the reference does not reset its reading state", async () => {
  const me = await newUser();
  const r = await ref(me);
  await refs.setReading(me, r.id, { status: "done", takeaway: "Kept." });
  const edited = await refs.updateReference(me, r.id, { key: r.key, type: "article", title: "A better title", authors: r.authors, year: 2017 });
  assert.equal(edited.title, "A better title");
  assert.deepEqual([edited.readStatus, edited.takeaway], ["done", "Kept."]);
});

test("another account's, a missing and a malformed id are the one refusal, and nothing is written", async () => {
  const me = await newUser();
  const other = await newUser();
  const mine = await ref(me);
  const theirs = await ref(other, "theirs");
  for (const id of [theirs.id, randomUUID(), "not-a-uuid", "", "' OR 1=1 --"]) {
    await assert.rejects(() => refs.setReading(me, id, { status: "done", takeaway: "x" }), refusedAs("RESOURCE_NOT_FOUND"), id);
  }
  assert.deepEqual([(await refs.getReference(other, theirs.id)).readStatus, (await refs.getReference(other, theirs.id)).takeaway], ["to_read", null]);
  assert.equal((await refs.getReference(me, mine.id)).readStatus, "to_read");
});

test("invalid input is refused and writes nothing", async () => {
  const me = await newUser();
  const r = await ref(me);
  await refs.setReading(me, r.id, { status: "reading", takeaway: "keep me" });
  for (const bad of [{ status: "finished", takeaway: "x" }, { status: "done", takeaway: "x".repeat(201) }, { status: "done", takeaway: 7 }, { takeaway: "x" }, null]) {
    await assert.rejects(() => refs.setReading(me, r.id, bad), refusedAs("VALIDATION_ERROR"), JSON.stringify(bad));
  }
  const after = await refs.getReference(me, r.id);
  assert.deepEqual([after.readStatus, after.takeaway], ["reading", "keep me"]);
});

test("a stored status that is not one of the three reads as to read", async () => {
  const me = await newUser();
  const r = await ref(me);
  await prisma.reference.update({ where: { id: r.id }, data: { readStatus: "finished-in-some-older-release" } });
  assert.equal((await refs.getReference(me, r.id)).readStatus, "to_read");
});

test("how many notes cite each key: brackets and bare, live notes only, once per note, my own only", async () => {
  const me = await newUser();
  const other = await newUser();
  await ref(me, "a2020");
  await ref(me, "b2021");
  await note(me, "See [@a2020, p. 3] and again [@a2020].");
  await note(me, "Bare @a2020 and [@b2021]");
  await note(me, "In code `[@b2021]` does not count");
  await note(me, "```\n[@b2021]\n```");
  await note(me, "Trashed [@b2021]", { deletedAt: new Date() });
  await note(me, "An email x@a2020.com is not a citation");
  await note(me, "A work I do not have: [@stranger1999]");
  await note(other, "Theirs [@a2020] [@b2021]");
  const { counts, capped } = await refs.citationCounts(me, ["a2020", "b2021", "nokey"]);
  assert.equal(counts.get("a2020"), 2, "counted once per note, however often it is cited");
  assert.equal(counts.get("b2021"), 1, "code, trash and another account's notes do not count");
  assert.equal(counts.get("nokey"), undefined);
  assert.equal(counts.has("stranger1999"), false, "a key that is not one of mine is not counted");
  assert.deepEqual([...counts.keys()].sort(), ["a2020", "b2021"]);
  assert.equal(capped, false);
});

test("the notes read for counts are the caller's own and live, on their own (a missing filter would be masked)", async () => {
  const me = await newUser();
  const other = await newUser();
  await note(me, "mine @x");
  await note(me, "trashed @x", { deletedAt: new Date() });
  await note(other, "theirs @x");
  await note(me, "no at sign here");
  assert.deepEqual(await noteTextsWithAt(me, 10), ["mine @x"]);
  assert.deepEqual(await noteTextsWithAt(me, 0), []);
});

test("the export carries the reading state of each reference", async () => {
  const me = await newUser();
  const r = await ref(me);
  await refs.setReading(me, r.id, { status: "done", takeaway: "Exported." });
  const row = await prisma.reference.findFirstOrThrow({ where: { userId: me } });
  assert.deepEqual([row.readStatus, row.takeaway], ["done", "Exported."]);
});

test("a work with a reading state still counts as unchanged when the same BibTeX is imported again", async () => {
  const me = await newUser();
  const bib = "@article{same2020, title = {Same}, author = {Ada, A.}, journal = {J}, year = {2020}}";
  await refs.applyImport(me, bib);
  const r = await prisma.reference.findFirstOrThrow({ where: { userId: me } });
  await refs.setReading(me, r.id, { status: "done", takeaway: "Kept." });
  const preview = await refs.previewImport(me, bib);
  assert.equal(preview.unchanged, 1, "reading state is not part of what the BibTeX says");
  assert.equal(preview.differing.length, 0);
});

test("with more than a thousand notes that could cite, the count says it is at least that", async () => {
  const me = await newUser();
  await ref(me, "many2020");
  await prisma.note.createMany({ data: Array.from({ length: 1_001 }, (_, i) => ({ userId: me, title: `N${i}`, content: "cites [@many2020]", tags: [] })) });
  const { counts, capped } = await refs.citationCounts(me, ["many2020"]);
  assert.equal(capped, true);
  assert.equal(counts.get("many2020"), 1_000, "only the thousand most recently edited are read");
  const few = await newUser();
  await ref(few, "few2020");
  await note(few, "[@few2020]");
  assert.equal((await refs.citationCounts(few, ["few2020"])).capped, false);
});
