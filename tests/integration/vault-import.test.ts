/**
 * Restoring from a vault against a real Postgres and the real attachment directory, DB-only like
 * the rest of this tier. Zips are built here, some by hand so that a field can lie. Each test makes
 * its own accounts so one test's rows cannot leak into another's.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { getAttachment, putAttachment, deleteAttachment } from "@/lib/attachment-store";
import { ZipWriter } from "@/lib/zip";
import { VAULT, noteFile } from "@/lib/vault";
import { contentHash } from "@/lib/vault-import";
import * as noteRepository from "@/repositories/note-repository";
import * as noteService from "@/services/note-service";
import { runVaultImport, streamVault } from "@/services/vault-service";

const users: string[] = [];

async function newUser(): Promise<{ id: string; email: string }> {
  const user = await prisma.user.create({ data: { email: `vault-in-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user;
}

after(async () => {
  const rows = await prisma.attachment.findMany({ where: { userId: { in: users } }, select: { storageKey: true } });
  await Promise.all(rows.map((row) => deleteAttachment(row.storageKey)));
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const when = new Date("2026-10-01T09:00:00Z");

type File = { name: string; data: string | Buffer };

async function makeZip(files: File[]): Promise<Buffer> {
  const writer = new ZipWriter();
  const parts: Buffer[] = [];
  for (const file of files) parts.push(await writer.add({ name: file.name, data: Buffer.from(file.data), modified: when }));
  parts.push(writer.finish());
  return Buffer.concat(parts);
}

/** A note in the exporter's own format. */
function md(title: string, content: string, extra: { tags?: string[]; favorite?: boolean; course?: string | null; project?: string | null; attachments?: string[] } = {}): File {
  return {
    name: `${title}.md`,
    data: noteFile(
      { title, content, tags: extra.tags ?? [], isFavorite: extra.favorite ?? false, createdAt: when, updatedAt: when },
      { course: extra.course ?? null, project: extra.project ?? null, attachments: extra.attachments ?? [] },
    ),
  };
}

type Raw = { name: string; data: Buffer; method?: number; flags?: number; crc?: number; size?: number; compressedSize?: number; madeBy?: number; external?: number };

/** A zip assembled by hand, so each field can be made to lie. */
function rawZip(entries: Raw[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const method = e.method ?? 0;
    const flags = e.flags ?? 0x0800;
    const compressedSize = e.compressedSize ?? e.data.length;
    const size = e.size ?? e.data.length;
    const crc = e.crc ?? (method === 0 ? crc32(e.data) : 0);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(flags, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(compressedSize, 18);
    head.writeUInt32LE(size, 22);
    head.writeUInt16LE(name.length, 26);
    const rec = Buffer.alloc(46);
    rec.writeUInt32LE(0x02014b50, 0);
    rec.writeUInt16LE(e.madeBy ?? 20, 4);
    rec.writeUInt16LE(20, 6);
    rec.writeUInt16LE(flags, 8);
    rec.writeUInt16LE(method, 10);
    rec.writeUInt32LE(crc, 16);
    rec.writeUInt32LE(compressedSize, 20);
    rec.writeUInt32LE(size, 24);
    rec.writeUInt16LE(name.length, 28);
    rec.writeUInt32LE(e.external ?? 0, 38);
    rec.writeUInt32LE(offset, 42);
    local.push(head, name, e.data);
    central.push(rec, name);
    offset += 30 + name.length + e.data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

const count = (userId: string) => prisma.note.count({ where: { userId, deletedAt: null } });
const titlesOf = async (userId: string) => (await prisma.note.findMany({ where: { userId, deletedAt: null }, select: { title: true } })).map((n) => n.title).sort();
const apply = (userId: string, bytes: Buffer, options: { limit?: number } = {}) => runVaultImport(userId, bytes, { apply: true, ...options });
const preview = (userId: string, bytes: Buffer) => runVaultImport(userId, bytes, { apply: false });
const attachmentFiles = async () => (await readdir(path.join(process.cwd(), "data", "attachments")).catch(() => [])).sort();

async function exportOf(userId: string): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of streamVault(userId)) parts.push(chunk);
  return Buffer.concat(parts);
}

// --- preview and apply --------------------------------------------------------------------------

test("a preview writes nothing, and apply does what it said", async () => {
  const user = await newUser();
  const zip = await makeZip([md("A", "one", { attachments: ["a.png"] }), md("B", "two", { tags: ["x"] }), { name: "attachments/a.png", data: PNG }]);
  const seen = await preview(user.id, zip);
  assert.equal(seen.apply, false);
  assert.equal(seen.notes.create, 2);
  assert.equal(seen.notes.created, 0);
  assert.equal(seen.attachments.stored, 1, "a preview says what it would store");
  assert.equal(await count(user.id), 0, "a preview creates no note");
  assert.equal(await prisma.attachment.count({ where: { userId: user.id } }), 0, "and no attachment");

  const done = await apply(user.id, zip);
  assert.equal(done.apply, true);
  assert.equal(done.notes.create, seen.notes.create);
  assert.equal(done.notes.created, 2);
  assert.equal(done.notes.present, seen.notes.present);
  assert.deepEqual(done.notes.renamed, seen.notes.renamed);
  assert.deepEqual(done.skipped, seen.skipped);
  assert.equal(done.attachments.stored, seen.attachments.stored);
  assert.equal(await count(user.id), 2);
  assert.equal(await prisma.attachment.count({ where: { userId: user.id } }), 1);
});

test("importing the same zip twice creates nothing the second time", async () => {
  const user = await newUser();
  const zip = await makeZip([md("A", "one"), md("B", "two"), md("Empty", "")]);
  assert.equal((await apply(user.id, zip)).notes.created, 3);
  const second = await apply(user.id, zip);
  assert.equal(second.notes.created, 0);
  assert.equal(second.notes.present, 3);
  assert.equal(second.notes.create, 0);
  assert.equal(await count(user.id), 3);
  assert.equal((await preview(user.id, zip)).notes.create, 0);
});

// --- a restore ----------------------------------------------------------------------------------

test("an export of one account restores into another: text, tags, favourite, course, project, attachments and links", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const aCourse = await prisma.course.create({ data: { userId: alice.id, code: "CMP2003", title: "DS", term: "Fall" } });
  const aProject = await prisma.project.create({ data: { userId: alice.id, title: "Thesis", category: "University" } });
  const alpha = await prisma.note.create({
    data: { userId: alice.id, courseId: aCourse.id, projectId: aProject.id, title: "Alpha", content: "See [[Beta]] and $x^2$ ğ.\n", tags: ["ai", "school"], isFavorite: true },
  });
  await prisma.note.create({ data: { userId: alice.id, title: "Beta", content: "linked", tags: [] } });
  const pdf = Buffer.from("%PDF-1.7\n".repeat(300));
  for (const [name, mime, bytes] of [["diagram.png", "image/png", PNG], ["paper.pdf", "application/pdf", pdf]] as const) {
    const key = await putAttachment(bytes, mime);
    await prisma.attachment.create({ data: { userId: alice.id, noteId: alpha.id, filename: name, mimeType: mime, byteSize: bytes.length, storageKey: key } });
  }
  const aliceBefore = await prisma.note.findMany({ where: { userId: alice.id }, orderBy: { title: "asc" } });

  const bCourse = await prisma.course.create({ data: { userId: bob.id, code: "cmp2003", title: "Other title", term: "Spring" } });
  const bProject = await prisma.project.create({ data: { userId: bob.id, title: "THESIS", category: "University" } });
  const report = await apply(bob.id, await exportOf(alice.id));
  assert.equal(report.notes.created, 2);
  assert.equal(report.attachments.stored, 2);
  assert.equal(report.notes.withoutCourse + report.notes.withoutProject, 0);

  const restored = await prisma.note.findFirstOrThrow({ where: { userId: bob.id, title: "Alpha" } });
  assert.equal(restored.content, alpha.content);
  assert.deepEqual(restored.tags, ["ai", "school"]);
  assert.equal(restored.isFavorite, true);
  assert.equal(restored.courseId, bCourse.id, "matched by code, never created");
  assert.equal(restored.projectId, bProject.id, "matched by title, case ignored");
  assert.notEqual(restored.id, alpha.id);

  const rows = await prisma.attachment.findMany({ where: { userId: bob.id, noteId: restored.id }, orderBy: { filename: "asc" } });
  assert.deepEqual(rows.map((r) => [r.filename, r.mimeType]), [["diagram.png", "image/png"], ["paper.pdf", "application/pdf"]]);
  assert.deepEqual(await getAttachment(rows[0].storageKey), PNG);
  assert.deepEqual(await getAttachment(rows[1].storageKey), pdf);
  for (const row of rows) assert.match(row.storageKey, /^[0-9a-f-]{36}\.[a-z]{2,4}$/);
  const alicesKeys = (await prisma.attachment.findMany({ where: { userId: alice.id } })).map((r) => r.storageKey);
  for (const row of rows) assert.ok(!alicesKeys.includes(row.storageKey), "a file of its own, not Alice's");

  const beta = await prisma.note.findFirstOrThrow({ where: { userId: bob.id, title: "Beta" } });
  const links = await prisma.entityLink.findMany({ where: { userId: bob.id } });
  assert.ok(links.some((l) => l.sourceId === restored.id && l.targetId === beta.id), "the link between the restored notes resolves");

  const aliceAfter = await prisma.note.findMany({ where: { userId: alice.id }, orderBy: { title: "asc" } });
  assert.deepEqual(aliceAfter.map((n) => [n.id, n.title, n.content, +n.updatedAt]), aliceBefore.map((n) => [n.id, n.title, n.content, +n.updatedAt]), "the exporting account is untouched");
});

test("a course or project this account does not have is left out and counted, never created", async () => {
  const user = await newUser();
  await prisma.course.create({ data: { userId: user.id, code: "AMB1", title: "One", term: "Fall" } });
  await prisma.course.create({ data: { userId: user.id, code: "AMB1", title: "Two", term: "Spring" } });
  await prisma.course.create({ data: { userId: user.id, code: "GONE1", title: "Dropped", term: "Fall", deletedAt: new Date() } });
  const zip = await makeZip([
    md("Ambiguous", "a", { course: "AMB1" }),
    md("Deleted course", "b", { course: "GONE1" }),
    md("Unknown", "c", { course: "NOPE9", project: "No such project" }),
  ]);
  const report = await apply(user.id, zip);
  assert.equal(report.notes.created, 3);
  assert.equal(report.notes.withoutCourse, 3);
  assert.equal(report.notes.withoutProject, 1);
  assert.equal(await prisma.course.count({ where: { userId: user.id } }), 3, "no course made");
  assert.equal(await prisma.project.count({ where: { userId: user.id } }), 0, "no project made");
  assert.equal(await prisma.note.count({ where: { userId: user.id, OR: [{ courseId: { not: null } }, { projectId: { not: null } }] } }), 0);
});

// --- titles that clash --------------------------------------------------------------------------

test("a note of a title the account already has comes in renamed, and the old one keeps the link", async () => {
  const user = await newUser();
  const mine = await noteService.createNote(user.id, { title: "Thesis", content: "mine", tags: [], isFavorite: false, projectId: null, courseId: null });
  const zip = await makeZip([md("Thesis", "an older draft"), md("Intro", "points at [[Thesis]]")]);
  const report = await apply(user.id, zip);
  assert.equal(report.notes.created, 2);
  assert.deepEqual(report.notes.renamed, [{ from: "Thesis", to: "Thesis (imported)" }]);
  assert.deepEqual(await titlesOf(user.id), ["Intro", "Thesis", "Thesis (imported)"]);
  const still = await prisma.note.findUniqueOrThrow({ where: { id: mine.id } });
  assert.equal(still.content, "mine");
  const intro = await prisma.note.findFirstOrThrow({ where: { userId: user.id, title: "Intro" } });
  const links = await prisma.entityLink.findMany({ where: { userId: user.id, sourceId: intro.id } });
  assert.deepEqual(links.map((l) => l.targetId), [mine.id], "the link went to the note the account already had");

  assert.equal((await apply(user.id, zip)).notes.created, 0, "a second run adds nothing, renamed note included");
  assert.equal(await count(user.id), 3);
});

test("a note changed since the export comes in beside the original, once", async () => {
  const user = await newUser();
  await apply(user.id, await makeZip([md("Plan", "version one")]));
  const changed = await makeZip([md("Plan", "version two")]);
  const report = await apply(user.id, changed);
  assert.equal(report.notes.created, 1);
  assert.deepEqual(await titlesOf(user.id), ["Plan", "Plan (imported)"]);
  assert.equal((await apply(user.id, changed)).notes.created, 0);
  assert.equal(await count(user.id), 2);
});

test("two notes of one title inside the file both come in, and neither twice", async () => {
  const user = await newUser();
  const zip = await makeZip([{ name: "a/Same.md", data: "one" }, { name: "b/Same.md", data: "two" }, { name: "c/Same.md", data: "one" }]);
  const report = await apply(user.id, zip);
  assert.equal(report.notes.created, 2);
  assert.equal(report.notes.present, 1);
  assert.deepEqual(await titlesOf(user.id), ["Same", "Same"]);
  assert.equal((await apply(user.id, zip)).notes.created, 0);
});

test("a trashed note is not a note the account has", async () => {
  const user = await newUser();
  await prisma.note.create({ data: { userId: user.id, title: "Old", content: "text", tags: [], deletedAt: new Date() } });
  const report = await apply(user.id, await makeZip([md("Old", "text")]));
  assert.equal(report.notes.created, 1);
  assert.equal(report.notes.renamed.length, 0);
  assert.equal(await count(user.id), 1);
});

test("what the account already holds is only its own", async () => {
  const alice = await newUser();
  const bob = await newUser();
  await noteService.createNote(alice.id, { title: "Shared title", content: "same text", tags: [], isFavorite: false, projectId: null, courseId: null });
  const report = await apply(bob.id, await makeZip([md("Shared title", "same text")]));
  assert.equal(report.notes.created, 1, "Alice's note is not Bob's");
  assert.equal(report.notes.present, 0);
  assert.equal(report.notes.renamed.length, 0);
});

test("the existing-note identity the database computes equals the one the plan computes", async () => {
  const user = await newUser();
  const texts = ["a\r\nb", "a\rb", "İstanbul ğ ş ı\r\n😀 end", "", "plain", "x".repeat(5000) + "\r\n"];
  for (const [i, content] of texts.entries()) await prisma.note.create({ data: { userId: user.id, title: `T${i}`, content, tags: [] } });
  const rows = await noteRepository.listImportIdentities(user.id);
  assert.equal(rows.length, texts.length);
  for (const [i, content] of texts.entries()) {
    assert.equal(rows.find((r) => r.title === `T${i}`)?.hash, contentHash(content), JSON.stringify(content.slice(0, 20)));
  }
  // Notes saved earlier hold CR LF: the same text from a vault is the note that is already there.
  const report = await apply(user.id, await makeZip([{ name: "T0.md", data: "a\nb" }, { name: "T2.md", data: "İstanbul ğ ş ı\n😀 end" }]));
  assert.equal(report.notes.present, 2);
  assert.equal(report.notes.created, 0);
});

// --- nothing in the file is trusted -------------------------------------------------------------

test("a file that claims ids and owners changes nothing of anyone else's", async () => {
  const victim = await newUser();
  const attacker = await newUser();
  const theirs = await noteService.createNote(victim.id, { title: "Victim note", content: "private", tags: [], isFavorite: false, projectId: null, courseId: null });
  const text = [
    "---",
    "anamnesis: 1",
    'title: "Taken over"',
    `id: ${theirs.id}`,
    `noteId: ${theirs.id}`,
    `userId: ${victim.id}`,
    `userid: ${victim.id}`,
    `owner: ${victim.email}`,
    `courseId: ${randomUUID()}`,
    "deletedAt: null",
    "---",
    "claimed body",
  ].join("\n");
  const report = await apply(attacker.id, await makeZip([{ name: "Taken over.md", data: text }]));
  assert.equal(report.notes.created, 1);
  assert.ok(report.droppedProperties >= 1, "the extra properties are named, not obeyed");
  const created = await prisma.note.findFirstOrThrow({ where: { title: "Taken over" } });
  assert.equal(created.userId, attacker.id);
  assert.notEqual(created.id, theirs.id);
  assert.equal(created.courseId, null);
  const untouched = await prisma.note.findUniqueOrThrow({ where: { id: theirs.id } });
  assert.deepEqual([untouched.userId, untouched.title, untouched.content, +untouched.updatedAt], [victim.id, "Victim note", "private", +theirs.updatedAt]);
  assert.equal(await count(victim.id), 1);
});

// --- attachments --------------------------------------------------------------------------------

test("attachments are checked, stored under generated names, and nothing lands outside the attachment directory", async () => {
  const user = await newUser();
  const names = ["ok.png", "html.png", "big.png", "evil.png", "missing.png", "enc.png"];
  const note = md("N", "body", { attachments: names });
  const entries: Raw[] = [
    { name: "N.md", data: Buffer.from(note.data) },
    { name: "attachments/ok.png", data: PNG },
    { name: "attachments/html.png", data: Buffer.from("<html><script>alert(1)</script></html>") },
    { name: "attachments/big.png", data: Buffer.alloc(0), size: 10 * 1024 * 1024 + 1, compressedSize: 0 },
    { name: "../../evil.png", data: PNG },
    { name: "attachments/enc.png", data: PNG, flags: 0x0801 },
  ];
  // Only places nothing else writes to: other test files add attachment files at the same time.
  const watched = [process.cwd(), path.join(process.cwd(), "data")];
  const before = await Promise.all(watched.map((dir) => readdir(dir).then((x) => x.sort())));

  const report = await apply(user.id, rawZip(entries));
  assert.equal(report.notes.created, 1);
  assert.equal(report.attachments.stored, 1);
  const rejected = Object.fromEntries(report.attachments.rejected.map((r) => [r.name, r.reason]));
  assert.deepEqual(Object.keys(rejected).sort(), ["big.png", "enc.png", "evil.png", "html.png", "missing.png"]);
  assert.match(rejected["html.png"], /not what/i);
  assert.match(rejected["big.png"], /large/i);
  assert.match(rejected["enc.png"], /encrypt/i);
  assert.match(rejected["missing.png"], /not in the zip/i);
  assert.match(rejected["evil.png"], /not in the zip/i, "an entry with a climbing path is never used");

  const stored = await prisma.attachment.findMany({ where: { userId: user.id } });
  assert.equal(stored.length, 1);
  assert.match(stored[0].storageKey, /^[0-9a-f-]{36}\.png$/, "a generated name");
  assert.equal(existsSync(path.join(process.cwd(), "data", "attachments", stored[0].storageKey)), true);
  // Nothing in the store has a name that came from a file: every name is the generated shape.
  for (const file of await attachmentFiles()) assert.match(file, /^[0-9a-f-]{36}\.[a-z]{2,4}$/, file);
  const after = await Promise.all(watched.map((dir) => readdir(dir).then((x) => x.sort())));
  assert.deepEqual(after[0], before[0], "nothing new in the working directory");
  assert.deepEqual(after[1], before[1], "nothing new in data/");
  assert.equal(existsSync(path.join(process.cwd(), "evil.png")), false);
  assert.equal(existsSync(path.join(process.cwd(), "..", "evil.png")), false);
  const row = await prisma.attachment.findFirstOrThrow({ where: { userId: user.id } });
  assert.equal(row.filename, "ok.png");
  assert.equal(row.byteSize, PNG.length);
});

test("a zip written with backslash paths (an old Windows tool) still finds the attachments its notes list", async () => {
  const user = await newUser();
  const note = md("From Windows", "x", { attachments: ["a.png"] });
  const report = await apply(user.id, rawZip([{ name: "From Windows.md", data: Buffer.from(note.data) }, { name: "attachments\\a.png", data: PNG }]));
  assert.equal(report.attachments.found, 1);
  assert.equal(report.attachments.stored, 1);
  assert.deepEqual(report.attachments.rejected, []);
});

test("an attachment is not stored a second time for a note that is already there", async () => {
  const user = await newUser();
  const zip = await makeZip([md("With file", "x", { attachments: ["a.png"] }), { name: "attachments/a.png", data: PNG }]);
  assert.equal((await apply(user.id, zip)).attachments.stored, 1);
  const keysAfterFirst = (await prisma.attachment.findMany({ where: { userId: user.id } })).map((r) => r.storageKey);
  const second = await apply(user.id, zip);
  assert.equal(second.notes.present, 1);
  assert.equal(second.attachments.stored, 0);
  assert.deepEqual((await prisma.attachment.findMany({ where: { userId: user.id } })).map((r) => r.storageKey), keysAfterFirst, "the same one file, no second");
});

// --- somebody else's vault ----------------------------------------------------------------------

test("an Obsidian vault of another tool: names are titles, tags kept, the rest reported", async () => {
  const user = await newUser();
  const zip = await makeZip([
    { name: "Notes/Trip plan.md", data: "---\ntags: [Travel, 2026]\naliases: [Holiday]\n---\nSee ![[photo.png]] and [[Other]]\n" },
    { name: "Other.md", data: "plain note\n" },
    { name: "Some folder/Şükrü.md".normalize("NFD"), data: "decomposed name" },
    { name: ".obsidian/app.json", data: "{}" },
    { name: ".obsidian/workspace.md", data: "not a note" },
    { name: "__MACOSX/._Other.md", data: "junk" },
    { name: "readme.txt", data: "ignored" },
    { name: "attachments/photo.png", data: PNG },
  ]);
  const report = await apply(user.id, zip);
  assert.equal(report.notes.created, 3);
  assert.deepEqual(await titlesOf(user.id), ["Other", "Trip plan", "Şükrü"].map((t) => t.normalize("NFC")).sort());
  const trip = await prisma.note.findFirstOrThrow({ where: { userId: user.id, title: "Trip plan" } });
  assert.deepEqual(trip.tags, ["imported", "travel", "2026"]);
  assert.equal(trip.isFavorite, false);
  assert.equal(report.droppedProperties, 1, "one note had a property with no place here");
  assert.equal(report.attachments.found, 1);
  assert.equal(report.attachments.stored, 0, "only our own files list their attachments");
  assert.equal(report.attachments.unreferenced, 1);
  assert.ok(report.ignored >= 4);
  const other = await prisma.note.findFirstOrThrow({ where: { userId: user.id, title: "Other" } });
  const links = await prisma.entityLink.findMany({ where: { userId: user.id, sourceId: trip.id } });
  assert.deepEqual(links.map((l) => l.targetId), [other.id]);
});

// --- limits and refusals ------------------------------------------------------------------------

test("a run creates up to its limit and a later run carries on, nothing twice", async () => {
  const user = await newUser();
  const zip = await makeZip(Array.from({ length: 7 }, (_, i) => md(`Note ${i}`, `text ${i}`)));
  const first = await apply(user.id, zip, { limit: 3 });
  assert.deepEqual([first.notes.created, first.notes.deferred], [3, 4]);
  const second = await apply(user.id, zip, { limit: 3 });
  assert.deepEqual([second.notes.created, second.notes.present, second.notes.deferred], [3, 3, 1]);
  const third = await apply(user.id, zip, { limit: 3 });
  assert.deepEqual([third.notes.created, third.notes.deferred], [1, 0]);
  assert.equal((await apply(user.id, zip, { limit: 3 })).notes.created, 0);
  assert.equal(await count(user.id), 7);
  assert.equal(new Set(await titlesOf(user.id)).size, 7);
});

test("what is not a zip, a truncated zip and a zip that would unpack to too much are refused in a sentence, with nothing written", async () => {
  const user = await newUser();
  const good = await makeZip([md("A", "one"), md("B", "two")]);
  const tooMuch = rawZip(Array.from({ length: 100 }, (_, i) => ({ name: `big${i}.md`, data: Buffer.alloc(0), size: 10 * 1024 * 1024, compressedSize: 0 })));
  for (const [label, bytes] of [["random", Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) % 251))], ["truncated", good.subarray(0, good.length - 30)], ["too much", tooMuch], ["empty", Buffer.alloc(0)], ["text", Buffer.from("hello")]] as const) {
    for (const run of [preview, apply]) {
      await assert.rejects(
        () => run(user.id, bytes as Buffer),
        (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR" && /zip|vault|file/i.test(error.message) && !/ZipError|at \w+ \(/.test(error.message),
        label,
      );
    }
  }
  assert.equal(await count(user.id), 0);
});

/** `count` notes that each list the same attachment, so every note costs one read of it. */
function sharedAttachmentZip(count: number, attachment: Buffer): Promise<Buffer> {
  const files: File[] = Array.from({ length: count }, (_, i) => md(`Shared ${String(i).padStart(3, "0")}`, "x", { attachments: ["shared.png"] }));
  files.push({ name: "attachments/shared.png", data: attachment });
  return makeZip(files);
}

test("one attachment listed by many notes cannot make an import write more than the size limit", async () => {
  const user = await newUser();
  // A 21 KB zip: sixty notes, each listing the one 10 MiB attachment. Unpacked once per note that is 600 MiB.
  const png = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 - PNG.length)]);
  const zip = await sharedAttachmentZip(60, png);
  assert.ok(zip.length < 100_000, `the zip is ${zip.length} bytes`);
  const report = await preview(user.id, zip);
  assert.equal(report.attachments.stored, 40, "40 x 10 MiB is the 400 MiB the whole zip may unpack to");
  assert.equal(report.notes.create, 40);
  assert.equal(report.notes.deferred, 20, "the rest wait for the next run");
});

test("notes deferred for the size of their attachments are imported by the next run, none twice", async () => {
  const user = await newUser();
  const zip = await sharedAttachmentZip(5, PNG); // each note reads a 70-byte file
  const first = await runVaultImport(user.id, zip, { apply: true, byteBudget: 2 * PNG.length + 10 });
  assert.deepEqual([first.notes.created, first.notes.deferred, first.attachments.stored], [2, 3, 2]);
  const second = await runVaultImport(user.id, zip, { apply: true, byteBudget: 2 * PNG.length + 10 });
  assert.deepEqual([second.notes.created, second.notes.present, second.notes.deferred], [2, 2, 1]);
  const third = await runVaultImport(user.id, zip, { apply: true, byteBudget: 2 * PNG.length + 10 });
  assert.deepEqual([third.notes.created, third.notes.deferred], [1, 0]);
  assert.equal(await count(user.id), 5);
  assert.equal(await prisma.attachment.count({ where: { userId: user.id } }), 5, "one attachment for each note, none repeated");
});

test("a note with no attachments is never held back by the size budget", async () => {
  const user = await newUser();
  const zip = await makeZip([md("Plain one", "a"), md("Plain two", "b")]);
  const report = await runVaultImport(user.id, zip, { apply: true, byteBudget: 0 });
  assert.equal(report.notes.created, 2);
  assert.equal(report.notes.deferred, 0);
});

test("a bomb is skipped, not unpacked: a thousand-to-one entry is over the size limit", async () => {
  const user = await newUser();
  const zeros = Buffer.alloc(64 * 1024 * 1024);
  const packed = deflateRawSync(zeros);
  const start = performance.now();
  const report = await apply(user.id, rawZip([{ name: "Bomb.md", data: packed, method: 8, size: zeros.length, crc: crc32(zeros) }, { name: "Fine.md", data: Buffer.from("fine") }]));
  assert.ok(performance.now() - start < 3000);
  assert.equal(report.notes.created, 1);
  assert.equal(report.skipped.length, 1);
  assert.match(report.skipped[0].reason, /large/i);
});

test("entries that cannot be notes are skipped with a reason: links, encrypted, climbing paths, duplicates, too long", async () => {
  const user = await newUser();
  const unix = (3 << 8) | 20;
  const entries: Raw[] = [
    { name: "link.md", data: Buffer.from("../../etc/passwd"), madeBy: unix, external: (0o120777 << 16) >>> 0 },
    { name: "secret.md", data: Buffer.from("x"), flags: 0x0801 },
    { name: "../up.md", data: Buffer.from("x") },
    { name: "C:\\win.md", data: Buffer.from("x") },
    { name: "Dup.md", data: Buffer.from("first") },
    { name: "Dup.md", data: Buffer.from("second") },
    { name: "Long.md", data: Buffer.from("x".repeat(100_001)) },
    { name: "Huge.md", data: Buffer.alloc(0), size: VAULT.maxMdBytes + 1, compressedSize: 0 },
    { name: "Good.md", data: Buffer.from("good") },
  ];
  const report = await apply(user.id, rawZip(entries));
  assert.equal(report.notes.created, 2);
  assert.deepEqual(await titlesOf(user.id), ["Dup", "Good"]);
  const reasons = Object.fromEntries(report.skipped.map((s) => [s.path, s.reason]));
  assert.match(reasons["link.md"], /link/i);
  assert.match(reasons["secret.md"], /encrypt/i);
  assert.ok(reasons["../up.md"]);
  assert.ok(reasons["C:\\win.md"]);
  assert.match(reasons["Long.md"], /100,000/);
  assert.match(reasons["Huge.md"], /large/i);
  assert.equal((await prisma.note.findFirstOrThrow({ where: { userId: user.id, title: "Dup" } })).content, "first");
  assert.ok(report.skipped.some((s) => /twice/i.test(s.reason)));
  assert.equal(report.skippedTotal, report.skipped.length);
});

test("the skipped list is capped, and a name cannot carry control characters into the report", async () => {
  const user = await newUser();
  const entries: Raw[] = Array.from({ length: 300 }, (_, i) => ({ name: `../climb${i}.md`, data: Buffer.alloc(0) }));
  entries.unshift({ name: `ctl\u0007\u001bname/../x${"y".repeat(300)}.md`, data: Buffer.alloc(0) }); // first, so it is inside the capped list
  const report = await preview(user.id, rawZip(entries));
  assert.equal(report.skippedTotal, 301);
  assert.ok(report.skipped.length <= 100);
  assert.ok(report.skipped.some((s) => s.path.startsWith("ctl??name/")), "the control characters are shown as ?");
  for (const s of report.skipped) assert.ok(!/\p{Cc}/u.test(s.path) && s.path.length <= 200);
});

test("one note that cannot be saved is counted and the others still come in, and its error is not shown", async () => {
  const user = await newUser();
  const zip = await makeZip([md("Good one", "a"), md("Bad", "b"), md("Good two", "c")]);
  const report = await runVaultImport(user.id, zip, {
    apply: true,
    deps: {
      createNote: async (userId, input) => {
        if (input.title === "Bad") throw new Error("boom: secret database detail");
        return noteService.createNote(userId, input);
      },
    },
  });
  assert.equal(report.notes.created, 2);
  assert.equal(report.notes.failed, 1);
  assert.deepEqual(await titlesOf(user.id), ["Good one", "Good two"]);
  assert.ok(report.skipped.some((s) => s.path === "Bad.md" && /could not be saved/i.test(s.reason)));
  assert.ok(!JSON.stringify(report).includes("secret database detail"));
  // The failed one is not "there", so a later run tries it again.
  assert.equal((await apply(user.id, zip)).notes.created, 1);
});

test("hostile sizes: a note of 100,000 characters comes in; twenty thousand entries are read in seconds", async () => {
  const user = await newUser();
  const big = "çğıöşü İ ".repeat(11_100).slice(0, 100_000);
  const start = performance.now();
  const report = await apply(user.id, await makeZip([{ name: "Big.md", data: big }]));
  assert.equal(report.notes.created, 1);
  assert.equal((await prisma.note.findFirstOrThrow({ where: { userId: user.id } })).content, big);
  assert.ok(performance.now() - start < 15_000, "slow");

  const many = await makeZip(Array.from({ length: 20_000 }, (_, i) => ({ name: `n${i}.md`, data: `text ${i}` })));
  const t = performance.now();
  const seen = await preview(user.id, many);
  assert.equal(seen.notes.found, 20_000);
  assert.equal(seen.notes.create, VAULT.maxImportNotes);
  assert.equal(seen.notes.deferred, 20_000 - VAULT.maxImportNotes);
  assert.ok(performance.now() - t < 15_000, `took ${(performance.now() - t).toFixed(0)} ms`);
});
