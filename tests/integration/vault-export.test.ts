/**
 * The vault download against a real Postgres and the real attachment directory, DB-only like the
 * rest of this tier. Each test makes its own accounts so one test's rows cannot leak into another's.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { openZip } from "@/lib/zip";
import { VAULT } from "@/lib/vault";
import { parseNoteFile } from "@/lib/vault-import";
import { putAttachment, deleteAttachment } from "@/lib/attachment-store";
import { streamVault, vaultPreflight } from "@/services/vault-service";

const users: string[] = [];
const keys: string[] = [];

async function newUser(): Promise<{ id: string; email: string }> {
  const user = await prisma.user.create({ data: { email: `vault-${randomUUID()}@test.local`, passwordHash: "x" } });
  users.push(user.id);
  return user;
}

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await Promise.all(keys.map((key) => deleteAttachment(key)));
  await prisma.$disconnect();
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function addNote(userId: string, data: { title: string; content?: string; tags?: string[]; isFavorite?: boolean; courseId?: string | null; projectId?: string | null; deletedAt?: Date | null; updatedAt?: Date }) {
  return prisma.note.create({ data: { userId, content: "", tags: [], ...data } });
}

async function addAttachment(userId: string, noteId: string, filename: string, bytes: Buffer, mimeType = "image/png") {
  const storageKey = await putAttachment(bytes, mimeType);
  keys.push(storageKey);
  return prisma.attachment.create({ data: { userId, noteId, filename, mimeType, byteSize: bytes.length, storageKey } });
}

async function collect(chunks: AsyncGenerator<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return Buffer.concat(parts);
}

/** The whole vault as name to bytes. */
async function vaultOf(userId: string, options?: { maxOffset?: number }): Promise<Map<string, Buffer>> {
  const zip = openZip(await collect(streamVault(userId, options)));
  const files = new Map<string, Buffer>();
  for (const entry of zip.entries) files.set(entry.name, await zip.read(entry));
  return files;
}

const notesIn = (files: Map<string, Buffer>) => [...files.keys()].filter((name) => name.endsWith(".md") && !name.startsWith("attachments/") && !name.startsWith(".anamnesis/"));
const text = (files: Map<string, Buffer>, name: string) => (files.get(name) as Buffer).toString("utf8");
const manifest = (files: Map<string, Buffer>) => JSON.parse(text(files, VAULT.manifestPath));

test("only the caller's live notes and their attachments are in the vault", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const mine = await addNote(alice.id, { title: "Alice live", content: "alice body" });
  const trashed = await addNote(alice.id, { title: "Alice trashed", content: "trashed body", deletedAt: new Date() });
  const theirs = await addNote(bob.id, { title: "Bob secret", content: "bob body" });
  await addAttachment(alice.id, mine.id, "mine.png", PNG);
  await addAttachment(alice.id, trashed.id, "trashed-file.png", Buffer.concat([PNG, Buffer.from("t")]));
  await addAttachment(bob.id, theirs.id, "bob-file.png", Buffer.concat([PNG, Buffer.from("b")]));

  const files = await vaultOf(alice.id);
  assert.deepEqual(notesIn(files), ["Alice live.md"]);
  assert.deepEqual([...files.keys()].filter((n) => n.startsWith("attachments/")), ["attachments/mine.png"]);
  const everything = [...files.entries()].map(([name, bytes]) => `${name}\n${bytes.toString("latin1")}`).join("\n");
  for (const secret of ["Bob secret", "bob body", "bob-file", "Alice trashed", "trashed body", "trashed-file"]) {
    assert.ok(!everything.includes(secret), `the vault holds "${secret}"`);
  }
  assert.equal(manifest(files).notes, 1);
  assert.equal(manifest(files).attachments, 1);
});

test("what is not in the vault cannot take a name: another account's or a trashed note's title and file name", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const now = Date.now();
  const mine = await addNote(alice.id, { title: "Same title", content: "alice", updatedAt: new Date(now - 60_000) });
  // Newer than mine, so whoever is allowed to take the plain name would take it from Alice.
  await addNote(bob.id, { title: "Same title", content: "bob", updatedAt: new Date(now) });
  await addNote(alice.id, { title: "Same title", content: "alice trashed", deletedAt: new Date(), updatedAt: new Date(now) });
  const bobsNote = await addNote(bob.id, { title: "Bob's" });
  const trashed = await addNote(alice.id, { title: "Trashed with a file", deletedAt: new Date() });
  await addAttachment(alice.id, mine.id, "shared.png", PNG);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await addAttachment(bob.id, bobsNote.id, "shared.png", Buffer.concat([PNG, Buffer.from("bob")]));
  await addAttachment(alice.id, trashed.id, "shared.png", Buffer.concat([PNG, Buffer.from("trash")]));

  const files = await vaultOf(alice.id);
  assert.deepEqual(notesIn(files), ["Same title.md"], "no number: the other copies are not in this vault");
  assert.equal(text(files, "Same title.md").includes("alice"), true);
  assert.deepEqual([...files.keys()].filter((n) => n.startsWith("attachments/")), ["attachments/shared.png"]);
  assert.deepEqual(files.get("attachments/shared.png"), PNG);
});

test("an attachment's bytes are the stored file's, and the note links it", async () => {
  const user = await newUser();
  const note = await addNote(user.id, { title: "With files" });
  const pdf = Buffer.from("%PDF-1.7\n".repeat(200));
  await addAttachment(user.id, note.id, "diagram.png", PNG);
  await addAttachment(user.id, note.id, "paper.pdf", pdf, "application/pdf");
  const files = await vaultOf(user.id);
  assert.deepEqual(files.get("attachments/diagram.png"), PNG);
  assert.deepEqual(files.get("attachments/paper.pdf"), pdf);
  const parsed = parseNoteFile("With files.md", text(files, "With files.md"));
  assert.ok(!("skip" in parsed));
  assert.deepEqual([...parsed.attachments].sort(), ["diagram.png", "paper.pdf"]);
  for (const name of parsed.attachments) assert.ok(files.has(`attachments/${name}`), `the link ${name} names no file`);
});

test("two attachments of one name, on two notes, are two files and each note links its own", async () => {
  const user = await newUser();
  const a = await addNote(user.id, { title: "A" });
  const b = await addNote(user.id, { title: "B" });
  const first = Buffer.concat([PNG, Buffer.from("first")]);
  const second = Buffer.concat([PNG, Buffer.from("second")]);
  await addAttachment(user.id, a.id, "diagram.png", first);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await addAttachment(user.id, b.id, "diagram.png", second);
  const files = await vaultOf(user.id);
  const linkOf = (title: string) => {
    const parsed = parseNoteFile(`${title}.md`, text(files, `${title}.md`));
    assert.ok(!("skip" in parsed));
    return parsed.attachments[0];
  };
  assert.notEqual(linkOf("A"), linkOf("B"));
  assert.deepEqual(files.get(`attachments/${linkOf("A")}`), first);
  assert.deepEqual(files.get(`attachments/${linkOf("B")}`), second);
});

test("a stored file that is gone from the disk is left out and named in the manifest", async () => {
  const user = await newUser();
  const note = await addNote(user.id, { title: "Missing one" });
  const gone = await addAttachment(user.id, note.id, "gone.png", PNG);
  await addAttachment(user.id, note.id, "kept.png", Buffer.concat([PNG, Buffer.from("k")]));
  await unlink(path.join(process.cwd(), "data", "attachments", gone.storageKey));
  const files = await vaultOf(user.id);
  assert.ok(!files.has("attachments/gone.png"));
  const parsed = parseNoteFile("Missing one.md", text(files, "Missing one.md"));
  assert.ok(!("skip" in parsed));
  assert.deepEqual(parsed.attachments, ["kept.png"]);
  assert.deepEqual(manifest(files).missing, [{ note: "Missing one", name: "gone.png" }]);
});

test("an attachment whose stored type may no longer be attached is left out, not exported", async () => {
  const user = await newUser();
  const note = await addNote(user.id, { title: "Odd type" });
  await prisma.attachment.create({ data: { userId: user.id, noteId: note.id, filename: "x.html", mimeType: "text/html", byteSize: 3, storageKey: `${randomUUID()}.txt` } });
  const files = await vaultOf(user.id);
  assert.deepEqual([...files.keys()].filter((n) => n.startsWith("attachments/")), []);
  assert.equal(manifest(files).missing.length, 1);
});

test("notes with the same title, and names a disk cannot take, get sane unique names", async () => {
  const user = await newUser();
  const base = Date.now();
  const older = await addNote(user.id, { title: "Thesis", content: "older", updatedAt: new Date(base - 5000) });
  const newer = await addNote(user.id, { title: "Thesis", content: "newer", updatedAt: new Date(base) });
  await addNote(user.id, { title: "note" });
  await addNote(user.id, { title: "NOTE" });
  await addNote(user.id, { title: "What is 1/2? A [draft]: yes|no" });
  await addNote(user.id, { title: "CON" });
  await addNote(user.id, { title: "ğ".repeat(200) });
  await addNote(user.id, { title: "Ş".normalize("NFD") + "ükrü" });
  const files = await vaultOf(user.id);
  const names = notesIn(files);
  assert.equal(new Set(names.map((n) => n.normalize("NFC").toLowerCase())).size, names.length, "unique when case is ignored");
  for (const name of names) assert.ok(Buffer.byteLength(name) <= 200, name);
  assert.equal(text(files, "Thesis.md").includes("newer"), true, "the most recently updated note keeps the plain name");
  assert.equal(text(files, "Thesis (2).md").includes("older"), true);
  assert.ok(names.includes("CON_.md"));
  assert.ok(names.includes("What is 1-2- A -draft-- yes-no.md"));
  const odd = parseNoteFile("What is 1-2- A -draft-- yes-no.md", text(files, "What is 1-2- A -draft-- yes-no.md"));
  assert.ok(!("skip" in odd));
  assert.equal(odd.title, "What is 1/2? A [draft]: yes|no", "the real title is in the front matter");
  assert.ok(newer.id !== older.id);
});

test("each note file reads back to its title, text, tags, favourite, course code and project title", async () => {
  const user = await newUser();
  const course = await prisma.course.create({ data: { userId: user.id, code: "CMP2003", title: "Data Structures", term: "Fall 2026" } });
  const project = await prisma.project.create({ data: { userId: user.id, title: "Thesis", category: "University" } });
  const deletedCourse = await prisma.course.create({ data: { userId: user.id, code: "OLD1", title: "Dropped", term: "Fall 2025", deletedAt: new Date() } });
  const content = "# Heading\n\nSee [[Other note]] and $x^2$.\n\n---\nnot front matter\n";
  await addNote(user.id, { title: "Full note", content, tags: ["ai", "school"], isFavorite: true, courseId: course.id, projectId: project.id });
  await addNote(user.id, { title: "In a dropped course", courseId: deletedCourse.id });
  await addNote(user.id, { title: "Other note", content: "linked" });
  const files = await vaultOf(user.id);

  const full = parseNoteFile("Full note.md", text(files, "Full note.md"));
  assert.ok(!("skip" in full));
  assert.equal(full.title, "Full note");
  assert.equal(full.content, content, "the text is exactly as stored, links included");
  assert.deepEqual(full.tags, ["ai", "school"]);
  assert.equal(full.favorite, true);
  assert.equal(full.course, "CMP2003");
  assert.equal(full.project, "Thesis");
  assert.equal(full.ours, true);

  const dropped = parseNoteFile("In a dropped course.md", text(files, "In a dropped course.md"));
  assert.ok(!("skip" in dropped));
  assert.equal(dropped.course, null, "a deleted course is not named");
});

test("a 100,000-character note with non-ASCII text arrives whole", async () => {
  const user = await newUser();
  const content = "çğıöşü İ ".repeat(11_000).slice(0, 100_000);
  await addNote(user.id, { title: "Big", content });
  const files = await vaultOf(user.id);
  const parsed = parseNoteFile("Big.md", text(files, "Big.md"));
  assert.ok(!("skip" in parsed));
  assert.equal(parsed.content, content);
});

test("no id, no email and no owner is anywhere in the vault", async () => {
  const user = await newUser();
  const note = await addNote(user.id, { title: "Plain" });
  const att = await addAttachment(user.id, note.id, "p.png", PNG);
  const files = await vaultOf(user.id);
  const everything = [...files.entries()].map(([name, bytes]) => `${name}\n${bytes.toString("latin1")}`).join("\n");
  for (const secret of [user.id, user.email, note.id, att.id, att.storageKey, "passwordHash", "userId"]) {
    assert.ok(!everything.includes(secret), `the vault holds ${secret}`);
  }
});

test("the manifest counts what is in the zip and says what is not", async () => {
  const user = await newUser();
  const a = await addNote(user.id, { title: "One" });
  await addNote(user.id, { title: "Two" });
  await addAttachment(user.id, a.id, "x.png", PNG);
  const files = await vaultOf(user.id);
  const info = manifest(files);
  assert.equal(info.formatVersion, VAULT.formatVersion);
  assert.equal(info.notes, 2);
  assert.equal(info.attachments, 1);
  assert.equal(files.size, info.notes + info.attachments + 1);
  assert.match(info.notIncluded.join(" "), /tasks/i);
});

test("an account with nothing in it gets a valid vault with only the manifest", async () => {
  const user = await newUser();
  const files = await vaultOf(user.id);
  assert.deepEqual([...files.keys()], [VAULT.manifestPath]);
  assert.equal(manifest(files).notes, 0);
});

test("more notes than a page arrive complete", async () => {
  const user = await newUser();
  await prisma.note.createMany({ data: Array.from({ length: 120 }, (_, i) => ({ userId: user.id, title: `Bulk ${String(i).padStart(3, "0")}`, content: `body ${i}`, tags: [] })) });
  const files = await vaultOf(user.id);
  const names = notesIn(files);
  assert.equal(names.length, 120);
  assert.equal(new Set(names).size, 120);
  assert.equal(manifest(files).notes, 120);
});

test("a vault that would pass the zip limit fails before it can pass for whole", async () => {
  const user = await newUser();
  const note = await addNote(user.id, { title: "Large" });
  await addAttachment(user.id, note.id, "a-small.png", PNG);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await addAttachment(user.id, note.id, "big.png", Buffer.concat([PNG, Buffer.alloc(5000, 7)]));
  const chunks: Buffer[] = [];
  await assert.rejects(
    async () => {
      for await (const chunk of streamVault(user.id, { maxOffset: 1000 })) chunks.push(chunk);
    },
    (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR" && /too large for one zip/i.test(error.message),
  );
  assert.equal(chunks.length, 1, "the first entry went out before the second failed");
  assert.throws(() => openZip(Buffer.concat(chunks)), "what was written never opens");
});

test("the preflight refuses an account too large for one zip, before any byte", async () => {
  const user = await newUser();
  const note = await addNote(user.id, { title: "P" });
  await addAttachment(user.id, note.id, "p.png", PNG);
  await assert.doesNotReject(() => vaultPreflight(user.id));
  await assert.rejects(() => vaultPreflight(user.id, { maxEntries: 2, maxBytes: 10_000_000 }), (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR" && /too large/i.test(error.message));
  await assert.rejects(() => vaultPreflight(user.id, { maxEntries: 100, maxBytes: 10 }), (error: unknown) => error instanceof AppError && /too large/i.test(error.message));
});

test("the preflight counts only the caller's own live notes and attachments", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const mine = await addNote(alice.id, { title: "Mine" });
  await addAttachment(alice.id, mine.id, "m.png", PNG);
  const trashed = await addNote(alice.id, { title: "Trashed", deletedAt: new Date() });
  await addAttachment(alice.id, trashed.id, "t.png", Buffer.concat([PNG, Buffer.alloc(2000, 1)]));
  const theirs = await addNote(bob.id, { title: "Theirs" });
  await prisma.note.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ userId: bob.id, title: `Bob ${i}`, content: "", tags: [] })) });
  await addAttachment(bob.id, theirs.id, "b.png", Buffer.concat([PNG, Buffer.alloc(5000, 2)]));
  // Alice: 1 note + 1 attachment + the manifest = 3 entries and a few dozen bytes of attachments.
  await assert.doesNotReject(() => vaultPreflight(alice.id, { maxEntries: 3, maxBytes: 200 }));
  await assert.rejects(() => vaultPreflight(alice.id, { maxEntries: 2, maxBytes: 200 }), AppError);
  await assert.rejects(() => vaultPreflight(alice.id, { maxEntries: 3, maxBytes: 50 }), AppError);
});

test("a missing or empty account id is refused before any query", async () => {
  for (const bad of [undefined, null, "", 42]) {
    await assert.rejects(async () => {
      for await (const chunk of streamVault(bad as never)) void chunk;
    }, (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR", String(bad));
    await assert.rejects(() => vaultPreflight(bad as never), AppError);
  }
});
