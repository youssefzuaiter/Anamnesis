/**
 * Locked notes (ROADMAP item 58) against a real Postgres. What matters is what must NOT happen: plaintext left in the row, in the history, in the search
 * index or in the links; another account's note opened or locked; a feature working on ciphertext; a wrong password counted as a right one.
 * Ollama may be off: indexing a note then logs a warning and carries on.
 */
import "dotenv/config";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { isLockedEnvelope } from "@/lib/note-lock";
import { hashPassword } from "@/lib/password";
import * as lock from "@/services/note-lock-service";
import { updateNote, restoreVersion, searchNotes } from "@/services/note-service";
import * as noteRepository from "@/repositories/note-repository";
import { quickSearch } from "@/repositories/search-repository";
import { summariseNote } from "@/services/summary-service";
import { proposeTodoTasks } from "@/services/todo-service";
import { generateCardsForNote, createCardsForNote } from "@/services/flashcard-service";
import { translateNote } from "@/services/translate-service";
import { proposeAssessments } from "@/services/syllabus-service";
import { addLink, suggestLinks } from "@/services/link-suggestion-service";
import { mergeNotes } from "@/services/duplicate-service";
import { buildFullExport } from "@/services/export-service";
import { runJsonRestore } from "@/services/restore-service";
import { reindexEverything } from "@/services/reindex-service";

const made: string[] = [];
const newUser = async () => {
  const user = await prisma.user.create({ data: { email: `lock-${randomUUID()}@test.local`, passwordHash: "x" } });
  made.push(user.id);
  return user.id;
};
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});
beforeEach(() => lock.resetUnlockAttempts());

const PW = "correct horse battery";
const SECRET = "the launch code is swordfish";
const code = (e: unknown) => (e instanceof AppError ? e.code : "other");
const rejectsWith = (p: Promise<unknown>, c: string, label = "") => assert.rejects(p, (e) => code(e) === c, label);

async function makeNote(userId: string, extra: Record<string, unknown> = {}) {
  return prisma.note.create({ data: { userId, title: "Plans", content: `# Plans\n\n${SECRET}\n\nSee [[Other]].`, tags: ["x"], ...extra } });
}
async function fixture() {
  const me = await newUser();
  const other = await prisma.note.create({ data: { userId: me, title: "Other", content: "other text" } });
  const note = await makeNote(me);
  await prisma.noteVersion.create({ data: { userId: me, noteId: note.id, title: "Plans", content: `old ${SECRET}` } });
  await prisma.$executeRaw`INSERT INTO "WorkspaceEmbedding" ("id","userId","sourceType","sourceId","contentChunk") VALUES (${randomUUID()}, ${me}, 'note', ${note.id}, ${SECRET})`;
  await prisma.entityLink.create({ data: { userId: me, sourceType: "note", sourceId: note.id, targetType: "note", targetId: other.id } });
  return { me, note, other };
}
const dump = async (userId: string) => JSON.stringify(await Promise.all([
  prisma.note.findMany({ where: { userId } }), prisma.noteVersion.findMany({ where: { userId } }), prisma.workspaceEmbedding.findMany({ where: { userId }, select: { contentChunk: true } }),
]));

test("locking leaves no plaintext in the row, the history, the index or the links, and returns a recovery key", async () => {
  const { me, note, other } = await fixture();
  const { recoveryKey } = await lock.lockNote(me, note.id, PW);
  assert.match(recoveryKey, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/);
  const row = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
  assert.equal(row.locked, true);
  assert.ok(isLockedEnvelope(row.content));
  assert.ok(!(await dump(me)).includes("swordfish"), "the secret appears nowhere in the account's rows");
  assert.equal(await prisma.noteVersion.count({ where: { noteId: note.id } }), 0);
  assert.equal(await prisma.workspaceEmbedding.count({ where: { sourceId: note.id } }), 0);
  assert.equal(await prisma.entityLink.count({ where: { sourceId: note.id } }), 0);
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: other.id } })).content, "other text", "another note is untouched");
  await rejectsWith(lock.lockNote(me, note.id, PW), "VALIDATION_ERROR", "already locked");
});

test("a note with attached files or cards, a short password, a trashed or foreign note, cannot be locked", async () => {
  const me = await newUser();
  const stranger = await newUser();
  const a = await makeNote(me);
  await rejectsWith(lock.lockNote(me, a.id, "short"), "VALIDATION_ERROR", "short");
  await prisma.attachment.create({ data: { userId: me, noteId: a.id, filename: "f.png", mimeType: "image/png", byteSize: 1, storageKey: randomUUID() } });
  await rejectsWith(lock.lockNote(me, a.id, PW), "VALIDATION_ERROR", "attachment");
  const b = await makeNote(me);
  await prisma.flashcard.create({ data: { userId: me, noteId: b.id, question: "q", answer: "a" } });
  await rejectsWith(lock.lockNote(me, b.id, PW), "VALIDATION_ERROR", "cards");
  const c = await makeNote(me, { deletedAt: new Date() });
  await rejectsWith(lock.lockNote(me, c.id, PW), "RESOURCE_NOT_FOUND", "trashed");
  const theirs = await makeNote(stranger);
  await rejectsWith(lock.lockNote(me, theirs.id, PW), "RESOURCE_NOT_FOUND", "foreign");
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: theirs.id } })).locked, false);
  for (const n of [a, b]) assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: n.id } })).content, n.content, "a refused lock changes nothing");
});

test("the password or the recovery key opens it; a wrong one does not and is counted; five wrong attempts stop even the right one", async () => {
  const { me, note } = await fixture();
  const { recoveryKey } = await lock.lockNote(me, note.id, PW);
  const t0 = 1_000_000;
  const byPw = await lock.unlockNote(me, note.id, PW, t0);
  assert.equal((await lock.readLocked(me, note.id, byPw.key))?.text, `# Plans\n\n${SECRET}\n\nSee [[Other]].`);
  const byRecovery = await lock.unlockNote(me, note.id, recoveryKey, t0);
  assert.deepEqual(byRecovery.key, byPw.key);
  for (let i = 0; i < 5; i += 1) await rejectsWith(lock.unlockNote(me, note.id, "wrong password!", t0 + i), "FORBIDDEN");
  await rejectsWith(lock.unlockNote(me, note.id, PW, t0 + 10), "RATE_LIMITED", "locked out");
  assert.ok(await lock.unlockNote(me, note.id, PW, t0 + 16 * 60 * 1000), "the window passes");
});

test("a note cannot be unlocked, read, saved or changed through another account's id, or one that is not locked", async () => {
  const { me, note } = await fixture();
  const stranger = await newUser();
  await lock.lockNote(me, note.id, PW);
  const { key } = await lock.unlockNote(me, note.id, PW);
  await rejectsWith(lock.unlockNote(stranger, note.id, PW), "RESOURCE_NOT_FOUND");
  await rejectsWith(lock.readLocked(stranger, note.id, key), "RESOURCE_NOT_FOUND");
  await rejectsWith(lock.saveLocked(stranger, note.id, key, { title: "x", content: "y" }), "RESOURCE_NOT_FOUND");
  await rejectsWith(lock.changeLockPassword(stranger, note.id, key, "another long password"), "RESOURCE_NOT_FOUND");
  await rejectsWith(lock.removeLock(stranger, note.id, key), "RESOURCE_NOT_FOUND");
  const plain = await makeNote(me);
  await rejectsWith(lock.unlockNote(me, plain.id, PW), "RESOURCE_NOT_FOUND", "an ordinary note is not unlockable");
  assert.ok(await lock.readLocked(me, note.id, key), "the owner still can");
});

test("ciphertext moved to another note does not open", async () => {
  const { me, note } = await fixture();
  await lock.lockNote(me, note.id, PW);
  const row = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
  const decoy = await makeNote(me, { content: row.content, locked: true, title: "Decoy" });
  await rejectsWith(lock.unlockNote(me, decoy.id, PW), "FORBIDDEN");
});

test("saving a locked note re-encrypts it under the same key, with no plaintext, version, vector or link made", async () => {
  const { me, note } = await fixture();
  await lock.lockNote(me, note.id, PW);
  const { key } = await lock.unlockNote(me, note.id, PW);
  const before = (await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).content;
  await lock.saveLocked(me, note.id, key, { title: "Plans v2", content: "new text with $x$ and [[Other]] and the password is hunter2" });
  const row = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
  assert.equal(row.title, "Plans v2");
  assert.notEqual(row.content, before);
  assert.ok(!(await dump(me)).includes("hunter2"));
  assert.equal((await lock.readLocked(me, note.id, key))?.text, "new text with $x$ and [[Other]] and the password is hunter2");
  assert.equal(await prisma.noteVersion.count({ where: { noteId: note.id } }), 0);
  assert.equal(await prisma.workspaceEmbedding.count({ where: { sourceId: note.id } }), 0);
  assert.equal(await prisma.entityLink.count({ where: { sourceId: note.id } }), 0);
  await rejectsWith(lock.saveLocked(me, note.id, Buffer.alloc(32), { title: "x", content: "y" }), "FORBIDDEN", "a wrong key");
});

test("a changed password opens it and the old one no longer does; the recovery key is unchanged", async () => {
  const { me, note } = await fixture();
  const { recoveryKey } = await lock.lockNote(me, note.id, PW);
  const { key } = await lock.unlockNote(me, note.id, PW);
  await rejectsWith(lock.changeLockPassword(me, note.id, key, "short"), "VALIDATION_ERROR");
  await lock.changeLockPassword(me, note.id, key, "a brand new passphrase");
  await rejectsWith(lock.unlockNote(me, note.id, PW), "FORBIDDEN");
  assert.ok(await lock.unlockNote(me, note.id, "a brand new passphrase"));
  assert.ok(await lock.unlockNote(me, note.id, recoveryKey));
});

test("removing the lock puts the text back as an ordinary, searchable note; a wrong key removes nothing", async () => {
  const { me, note } = await fixture();
  await lock.lockNote(me, note.id, PW);
  const { key } = await lock.unlockNote(me, note.id, PW);
  await rejectsWith(lock.removeLock(me, note.id, Buffer.alloc(32)), "FORBIDDEN");
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).locked, true);
  await lock.removeLock(me, note.id, key);
  const row = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
  assert.deepEqual([row.locked, row.content], [false, `# Plans\n\n${SECRET}\n\nSee [[Other]].`]);
  assert.equal(await prisma.entityLink.count({ where: { sourceId: note.id } }), 1, "its link is read from the text again");
});

test("an ordinary save, a version restore and the note's own listings never touch a locked note's text", async () => {
  const { me, note } = await fixture();
  await lock.lockNote(me, note.id, PW);
  const row = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
  const input = { title: "Plans", content: "overwritten", tags: [], isFavorite: false, projectId: null, courseId: null };
  await rejectsWith(updateNote(me, note.id, input), "FORBIDDEN");
  const version = await prisma.noteVersion.create({ data: { userId: me, noteId: note.id, title: "x", content: "y" } });
  await rejectsWith(restoreVersion(me, version.id), "FORBIDDEN");
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).content, row.content);
  const listed = (await noteRepository.listNotes(me)).find((n) => n.id === note.id)!;
  assert.deepEqual([listed.locked, listed.excerpt], [true, ""]);
});

test("features that read a note's text refuse a locked note, and searches skip its ciphertext", async () => {
  const { me, note, other } = await fixture();
  await lock.lockNote(me, note.id, PW);
  const course = await prisma.course.create({ data: { userId: me, code: "C1", title: "T", term: "Fall 2026" } });
  await rejectsWith(summariseNote(me, note.id), "FORBIDDEN", "summary");
  await rejectsWith(translateNote(me, note.id, "tr", { engine: async () => { throw new Error("must not be called"); } }), "FORBIDDEN", "translation");
  await rejectsWith(proposeTodoTasks(me, note.id), "FORBIDDEN", "todo lines");
  await rejectsWith(generateCardsForNote(me, note.id, 3), "FORBIDDEN", "card generation");
  await rejectsWith(createCardsForNote(me, note.id, { kind: "basic", question: "q", answer: "a" }), "FORBIDDEN", "a card by hand");
  await rejectsWith(proposeAssessments(me, course.id, note.id, { complete: async () => ({ items: [] }) }), "FORBIDDEN", "syllabus");
  await rejectsWith(addLink(me, note.id, other.id), "FORBIDDEN", "a link written into it");
  assert.deepEqual(await suggestLinks(me, note.id), []);
  await rejectsWith(mergeNotes(me, { keepId: other.id, dropId: note.id, keepUpdatedAt: Date.now(), dropUpdatedAt: Date.now() }), "FORBIDDEN", "merge");
  assert.equal(await prisma.flashcard.count({ where: { noteId: note.id } }), 0);
  // The stored text is base64 and JSON: a search for a fragment of it must not find the note.
  const row = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
  const fragment = row.content.slice(10, 30);
  assert.deepEqual((await searchNotes(me, fragment)).notes.filter((n) => n.id === note.id), []);
  assert.deepEqual((await quickSearch(me, fragment)).filter((h) => h.id === note.id), []);
  assert.deepEqual(await noteRepository.listNoteTexts(me, [note.id], 5), []);
  assert.deepEqual((await noteRepository.listNotesContaining(me, fragment, [], 5)).map((n) => n.id), []);
  assert.ok(!(await noteRepository.listCourseNotesForPrint(me, course.id, 5)).some((n) => n.id === note.id));
  await reindexEverything(me).catch(() => {});
  assert.equal(await prisma.workspaceEmbedding.count({ where: { sourceId: note.id } }), 0);
});

test("a locked note in a course is left out of the course's printed notes and of a rebuild of the index", async () => {
  const me = await newUser();
  const course = await prisma.course.create({ data: { userId: me, code: "C2", title: "T", term: "Fall 2026" } });
  const note = await makeNote(me, { courseId: course.id });
  await lock.lockNote(me, note.id, PW);
  assert.deepEqual(await noteRepository.listCourseNotesForPrint(me, course.id, 10), []);
  const report = await reindexEverything(me);
  assert.equal(report.byType.note ?? 0, 0, "a locked note is not attempted");
  assert.equal(report.indexed + report.failed, 1, "only the course is");
});

test("every repository write that locks, saves or unlocks is scoped to the owner on its own", async () => {
  const { me, note } = await fixture();
  const stranger = await newUser();
  assert.equal(await noteRepository.setLocked(stranger, note.id, "nxl1:x"), false);
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).locked, false);
  await lock.lockNote(me, note.id, PW);
  const row = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
  assert.equal(await noteRepository.saveLockedContent(stranger, note.id, { title: "hijack", envelope: "nxl1:y" }), false);
  assert.equal(await noteRepository.setUnlocked(stranger, note.id, "plain"), false);
  assert.deepEqual(await prisma.note.findUniqueOrThrow({ where: { id: note.id } }), row, "nothing about the note changed");
});

test("the JSON export holds ciphertext only, and a restore skips locked notes and says so", async () => {
  const { me, note } = await fixture();
  await lock.lockNote(me, note.id, PW);
  const file = JSON.stringify(await buildFullExport(me));
  assert.ok(!file.includes("swordfish"), "the export holds no plaintext of a locked note");
  const target = await newUser();
  const outcome = await runJsonRestore(target, new TextEncoder().encode(file), { apply: true });
  assert.ok(outcome.ok);
  if (!outcome.ok) return;
  assert.equal(outcome.report.lockedNotes, 1);
  const restored = await prisma.note.findMany({ where: { userId: target } });
  assert.ok(restored.every((n) => !n.locked && !isLockedEnvelope(n.content)), "no ciphertext came in as text");
  assert.ok(!restored.some((n) => n.title === "Plans"));
});

test("lock with the sign-in password: it must be the real one, may be short, opens the note, and the lock screen is told which password to ask for", async () => {
  const me = await newUser();
  await prisma.user.update({ where: { id: me }, data: { passwordHash: await hashPassword("signin1") } });
  const note = await makeNote(me);
  await rejectsWith(lock.lockNote(me, note.id, "wrong-one", "account"), "FORBIDDEN", "a wrong sign-in password");
  await rejectsWith(lock.lockNote(me, note.id, "", "account"), "VALIDATION_ERROR", "empty");
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).locked, false, "a refused lock changed nothing");
  const { recoveryKey } = await lock.lockNote(me, note.id, "signin1", "account");
  assert.match(recoveryKey, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/);
  assert.equal(await lock.lockViaOf(me, note.id), "account");
  const { key } = await lock.unlockNote(me, note.id, "signin1");
  assert.ok(await lock.readLocked(me, note.id, key));
  await rejectsWith(lock.unlockNote(me, note.id, "signin2"), "FORBIDDEN");
  assert.ok(await lock.unlockNote(me, note.id, recoveryKey), "the recovery key still opens it");
  // A separate password must still be long enough, and says "own".
  const other = await makeNote(me);
  await rejectsWith(lock.lockNote(me, other.id, "short1", "own"), "VALIDATION_ERROR");
  await lock.lockNote(me, other.id, PW, "own");
  assert.equal(await lock.lockViaOf(me, other.id), "own");
  const k2 = (await lock.unlockNote(me, other.id, PW)).key;
  await lock.changeLockPassword(me, note.id, key, "a brand new passphrase");
  assert.equal(await lock.lockViaOf(me, note.id), "own", "a new password makes it the note's own");
  assert.ok(k2);
});

test("guessing the sign-in password through the lock dialog is limited, and lockViaOf is the owner's only", async () => {
  const me = await newUser();
  const stranger = await newUser();
  await prisma.user.update({ where: { id: me }, data: { passwordHash: await hashPassword("signin1") } });
  const note = await makeNote(me);
  const t0 = 5_000_000;
  for (let i = 0; i < 5; i += 1) await rejectsWith(lock.lockNote(me, note.id, `guess-${i}`, "account", t0 + i), "FORBIDDEN");
  await rejectsWith(lock.lockNote(me, note.id, "signin1", "account", t0 + 10), "RATE_LIMITED", "even the right one is held back");
  assert.ok(await lock.lockNote(me, note.id, "signin1", "account", t0 + 16 * 60 * 1000), "the window passes");
  await rejectsWith(lock.lockViaOf(stranger, note.id), "RESOURCE_NOT_FOUND");
  await rejectsWith(lock.lockViaOf(me, (await makeNote(me)).id), "RESOURCE_NOT_FOUND", "an ordinary note");
});
