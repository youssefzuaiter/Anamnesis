import "server-only";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api-response";
import { deleteEntityEmbeddings } from "@/lib/vector";
import { prisma as db } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { checkPassword, isLockedEnvelope, lockVia, MIN_PASSWORD, type LockVia, openWithKey, openWithSecret, resealWithKey, rewrapPassword, sealNote } from "@/lib/note-lock";
import * as noteRepository from "@/repositories/note-repository";
import * as linkRepository from "@/repositories/link-repository";
import { syncNoteIndex, syncNoteLinks } from "@/services/note-service";

/*
 * Locked notes (ROADMAP 58). What a note's lock does, and what it refuses, is decided here; the cryptography is `lib/note-lock.ts` and the five minutes of
 * "unlocked" is a sealed cookie (`lib/unlock-cookie.ts`) the action sets. Every function takes the session's `userId` and every write names it.
 */

const LOCKED_MESSAGE = "This note is locked. Unlock it, or remove its lock, to use it here.";
/** Raised by any feature that would read a locked note's text, so none of them can quietly work on ciphertext. */
export const lockedError = () => new AppError("FORBIDDEN", LOCKED_MESSAGE);

/** Throws for a locked note: the guard every feature that reads note text calls right after loading it. */
export function assertNotLocked(note: { locked: boolean }): void {
  if (note.locked) throw lockedError();
}

const WRONG = "That is not the right password or recovery key.";
const FAILS_ALLOWED = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, number[]>();

function checkAttempts(key: string, now: number): void {
  const recent = (failures.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  failures.set(key, recent);
  if (recent.length >= FAILS_ALLOWED) throw new AppError("RATE_LIMITED", "Too many wrong attempts. Wait a few minutes and try again.");
}
const noteFailure = (key: string, now: number) => failures.set(key, [...(failures.get(key) ?? []), now]);

async function loadLocked(userId: string, noteId: string) {
  const note = await noteRepository.getNote(userId, noteId);
  if (!note || !note.locked || !isLockedEnvelope(note.content)) throw new AppError("RESOURCE_NOT_FOUND", "That locked note does not exist.");
  return note;
}

/**
 * Locks one of the caller's notes. Refused while the note has attachments (their files are not encrypted) or cards (they hold copies of its text), and
 * never for a note that is already locked or in the trash. The old text is removed from everywhere this app keeps it: the history, the search index and the
 * links read out of it. Returns the recovery key, which is shown once and kept nowhere.
 */
export async function lockNote(userId: string, noteId: string, password: string, how: LockVia = "own", now = Date.now()): Promise<{ recoveryKey: string }> {
  try {
    checkPassword(password, how === "account" ? 1 : MIN_PASSWORD);
  } catch (error) {
    throw new AppError("VALIDATION_ERROR", (error as Error).message);
  }
  if (how === "account") {
    // "Use my sign-in password": it must be the real one, so a typing slip cannot lock a note behind a password nobody has.
    const bucket = `${userId}:account`;
    checkAttempts(bucket, now);
    const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      noteFailure(bucket, now);
      throw new AppError("FORBIDDEN", "That is not your sign-in password.");
    }
    failures.delete(bucket);
  }
  const note = await noteRepository.getNote(userId, noteId);
  if (!note) throw new AppError("RESOURCE_NOT_FOUND", "That note no longer exists.");
  if (note.locked) throw new AppError("VALIDATION_ERROR", "This note is already locked.");
  const [attachments, cards] = await Promise.all([
    prisma.attachment.count({ where: { userId, noteId } }),
    prisma.flashcard.count({ where: { userId, noteId } }),
  ]);
  if (attachments > 0) throw new AppError("VALIDATION_ERROR", "This note has attached files, which are not encrypted. Remove them first.");
  if (cards > 0) throw new AppError("VALIDATION_ERROR", "Flashcards made from this note hold copies of its text. Delete them first.");

  const { envelope, recoveryKey } = await sealNote(note.content, password, { userId, noteId }, how);
  if (!(await noteRepository.setLocked(userId, noteId, envelope))) throw new AppError("RESOURCE_NOT_FOUND", "That note could not be locked. Reload and try again.");
  await Promise.all([
    noteRepository.deleteVersionsOf(userId, noteId),
    deleteEntityEmbeddings(userId, "note", noteId),
    linkRepository.replaceOutgoingLinks(userId, noteId, []),
  ]);
  return { recoveryKey };
}

/** Checks a password or recovery key and returns the data key, for the action to seal into the unlock cookie. Wrong attempts are counted. */
export async function unlockNote(userId: string, noteId: string, secret: string, now = Date.now()): Promise<{ key: Buffer }> {
  const note = await loadLocked(userId, noteId);
  const bucket = `${userId}:${noteId}`;
  checkAttempts(bucket, now);
  const opened = await openWithSecret(note.content, secret, { userId, noteId });
  if (!opened) {
    noteFailure(bucket, now);
    throw new AppError("FORBIDDEN", WRONG);
  }
  failures.delete(bucket);
  return { key: opened.key };
}

/** Which password a locked note asks for, for its lock screen: the caller's own locked note only. */
export async function lockViaOf(userId: string, noteId: string): Promise<LockVia> {
  return lockVia((await loadLocked(userId, noteId)).content);
}

/** The note's text, for a caller holding its key; null when the key does not open it. */
export async function readLocked(userId: string, noteId: string, key: Buffer): Promise<{ title: string; text: string; updatedAt: Date } | null> {
  const note = await loadLocked(userId, noteId);
  const text = openWithKey(note.content, key, { userId, noteId });
  return text === null ? null : { title: note.title, text, updatedAt: note.updatedAt };
}

/** Saves new text and title of a locked note under its own key; nothing of the text reaches the index, the history or the links. */
export async function saveLocked(userId: string, noteId: string, key: Buffer, fields: { title: string; content: string }): Promise<void> {
  const note = await loadLocked(userId, noteId);
  if (openWithKey(note.content, key, { userId, noteId }) === null) throw new AppError("FORBIDDEN", "This note is locked again. Unlock it to save.");
  const envelope = resealWithKey(note.content, key, fields.content, { userId, noteId });
  if (!(await noteRepository.saveLockedContent(userId, noteId, { title: fields.title, envelope }))) throw new AppError("RESOURCE_NOT_FOUND", "That note no longer exists.");
}

/** A new password for the same key. The recovery key does not change. */
export async function changeLockPassword(userId: string, noteId: string, key: Buffer, password: string): Promise<void> {
  const note = await loadLocked(userId, noteId);
  try {
    checkPassword(password);
  } catch (error) {
    throw new AppError("VALIDATION_ERROR", (error as Error).message);
  }
  if (openWithKey(note.content, key, { userId, noteId }) === null) throw new AppError("FORBIDDEN", "This note is locked again. Unlock it first.");
  const envelope = await rewrapPassword(note.content, key, password, { userId, noteId });
  if (!(await noteRepository.saveLockedContent(userId, noteId, { title: note.title, envelope }))) throw new AppError("RESOURCE_NOT_FOUND", "That note no longer exists.");
}

/** Takes the lock off: the text goes back into the note, which is indexed and linked again like any saved note. */
export async function removeLock(userId: string, noteId: string, key: Buffer): Promise<void> {
  const note = await loadLocked(userId, noteId);
  const text = openWithKey(note.content, key, { userId, noteId });
  if (text === null) throw new AppError("FORBIDDEN", "This note is locked again. Unlock it first.");
  if (!(await noteRepository.setUnlocked(userId, noteId, text))) throw new AppError("RESOURCE_NOT_FOUND", "That note no longer exists.");
  const fresh = await noteRepository.getNote(userId, noteId);
  if (fresh) {
    await syncNoteIndex(userId, fresh);
    await syncNoteLinks(userId, fresh);
  }
}

/** Test hook: forgets the counted wrong attempts. */
export function resetUnlockAttempts(): void {
  failures.clear();
}
