/** References against a real Postgres: ownership, keys, import, and which notes cite a work. */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import type { RefFields } from "@/lib/bibtex";
import * as references from "@/services/reference-service";

const users: string[] = [];
async function newUser() {
  const user = await prisma.user.create({ data: { email: `refs-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user.id;
}
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const work = (key: string, extra: Partial<RefFields> = {}): RefFields => ({
  key, type: "article", title: `On ${key}`, authors: [{ family: "Smith", given: "Jane" }], year: 2020, container: "Journal", ...extra,
});
const notFound = (error: unknown) => error instanceof AppError && error.code === "RESOURCE_NOT_FOUND";
const invalid = (message: RegExp) => (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR" && message.test(error.message);

test("a reference is the caller's alone, and another account's id is simply not found", async () => {
  const me = await newUser();
  const other = await newUser();
  const mine = await references.createReference(me, work("smith2020"));
  const theirs = await references.createReference(other, work("smith2020", { title: "Theirs" }));
  assert.equal(mine.key, "smith2020");
  assert.equal(theirs.key, "smith2020", "the same key in two accounts is fine");

  assert.deepEqual((await references.listReferences(me)).map((r) => r.title), ["On smith2020"]);
  assert.equal((await references.getReference(me, mine.id)).container, "Journal");
  await assert.rejects(() => references.getReference(me, theirs.id), notFound);
  await assert.rejects(() => references.updateReference(me, theirs.id, work("x")), notFound);
  await assert.rejects(() => references.deleteReference(me, theirs.id), notFound);
  await assert.rejects(() => references.getReference(me, randomUUID()), notFound);
  assert.deepEqual((await references.referencesByKeys(me, ["smith2020", "nope"])).map((r) => r.title), ["On smith2020"]);
  assert.equal((await references.getReference(other, theirs.id)).title, "Theirs", "untouched");
});

test("a key is unique per account, and invalid input writes nothing", async () => {
  const me = await newUser();
  await references.createReference(me, work("dup"));
  await assert.rejects(() => references.createReference(me, work("dup")), invalid(/already have a reference with the key "dup"/));
  for (const bad of [work("bad key"), work("ends."), work(""), work("x", { title: "" }), work("x", { year: 3000 }), work("x", { title: "t".repeat(1_001) }), work("x", { type: "poem" as never })]) {
    await assert.rejects(() => references.createReference(me, bad), (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR", JSON.stringify(bad).slice(0, 60));
  }
  assert.equal((await references.listReferences(me)).length, 1);
});

test("editing changes the fields, drops the imported BibTeX, and refuses another reference's key", async () => {
  const me = await newUser();
  const preview = await references.previewImport(me, "@article{one, title={One}, year={2001}}\n@article{two, title={Two}}");
  assert.equal(preview.added.length, 2);
  await references.applyImport(me, "@article{one, title={One}, year={2001}}\n@article{two, title={Two}}");
  const [one] = await references.referencesByKeys(me, ["one"]);
  assert.match(one.bibtex ?? "", /^@article\{one/);
  const edited = await references.updateReference(me, one.id, { ...one, title: "One, revised" });
  assert.equal(edited.title, "One, revised");
  assert.equal(edited.bibtex, null, "the imported entry no longer describes it");
  await assert.rejects(() => references.updateReference(me, one.id, { ...one, key: "two" }), invalid(/already have a reference with the key "two"/));
  await references.deleteReference(me, one.id);
  assert.deepEqual((await references.listReferences(me)).map((r) => r.key), ["two"]);
});

test("an import is previewed, adds only new keys, keeps yours, and adding it again adds nothing", async () => {
  const me = await newUser();
  await references.createReference(me, work("kept", { title: "My version" }));
  await references.createReference(me, work("same", { title: "Same", authors: [{ family: "Smith", given: "Jane" }], year: 2020, container: "Journal" }));
  const bib = `@article{new1, title={New one}, year={2019}}
@article{kept, title={Their version}}
@article{same, title={Same}, author={Smith, Jane}, journal={Journal}, year={2020}}
@article{broken, title={No end
@article{new2, title={New two}}`;
  const preview = await references.previewImport(me, bib);
  assert.deepEqual(preview.added.map((r) => r.key), ["new1", "new2"]);
  assert.deepEqual(preview.differing.map((r) => r.key), ["kept"]);
  assert.equal(preview.unchanged, 1);
  assert.equal(preview.problems.length, 1);
  assert.equal((await references.listReferences(me)).length, 2, "a preview writes nothing");

  assert.deepEqual(await references.applyImport(me, bib), { added: 2 });
  assert.deepEqual(await references.applyImport(me, bib), { added: 0 });
  const [kept] = await references.referencesByKeys(me, ["kept"]);
  assert.equal(kept.title, "My version");
});

test("an import over the limits is refused before anything is read", async () => {
  const me = await newUser();
  await assert.rejects(() => references.previewImport(me, "x".repeat(1_000_001)), invalid(/larger than 1 MB/));
  const many = Array.from({ length: 2_001 }, (_, i) => `@misc{k${i}, title={T}}`).join("\n");
  await assert.rejects(() => references.previewImport(me, many), invalid(/more than 2,000 entries/));
  await assert.rejects(() => references.applyImport(me, many), invalid(/more than 2,000 entries/));
  assert.equal((await references.listReferences(me)).length, 0);
});

test("the notes citing a key are the caller's live notes that cite exactly that key", async () => {
  const me = await newUser();
  const other = await newUser();
  const note = (userId: string, title: string, content: string, deletedAt: Date | null = null) =>
    prisma.note.create({ data: { userId, title, content, tags: [], deletedAt } });
  await note(me, "Cites it", "As shown [@smith2020, p. 4].");
  await note(me, "Bare", "@smith2020 argued this.");
  await note(me, "Longer key", "See [@smith2020b].");
  await note(me, "In code", "```\n[@smith2020]\n```");
  await note(me, "Trashed", "[@smith2020]", new Date());
  await note(other, "Theirs", "[@smith2020]");
  const citing = await references.notesCiting(me, "smith2020");
  assert.deepEqual(citing.map((n) => n.title).sort(), ["Bare", "Cites it"]);
});
