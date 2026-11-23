"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import { type ApiResponse, ok, fail, toApiResponse, AppError } from "@/lib/api-response";
import { MAX_PASSWORD } from "@/lib/note-lock";
import { noteContent } from "@/lib/note-text";
import { clearUnlockCookie, setUnlockCookie, unlockedKey } from "@/services/unlock-session";
import * as lockService from "@/services/note-lock-service";

/*
 * Locked notes (ROADMAP 58). The browser sends a note id and what the person typed; the owner is always the session's. A wrong id of any kind (another
 * account's, a trashed note, one that is not locked) answers the same way, and nothing here echoes a password or a key.
 */

const id = z.uuid();
const secret = z.string().min(1).max(MAX_PASSWORD);

/** Locks a note with a password. Returns the recovery key, once. */
export async function lockNoteAction(noteId: string, password: string): Promise<ApiResponse<{ recoveryKey: string }>> {
  const parsed = z.object({ noteId: id, password: secret }).strict().safeParse({ noteId, password });
  if (!parsed.success) return fail("VALIDATION_ERROR", "Choose a note and a password.");
  try {
    const userId = await requireUserId();
    const result = await lockService.lockNote(userId, parsed.data.noteId, parsed.data.password);
    // Neither a revalidation nor a cookie change here: either one makes Next re-render the page, which is now the locked page, and the card that is
    // showing the recovery key would be gone before it was read. (An ordinary note has no unlock cookie to clear.) The card refreshes the page itself,
    // when the person says they saved the key.
    return ok(result);
  } catch (error) {
    return toApiResponse(error);
  }
}

/** Checks the password (or recovery key) and, if right, unlocks this note in this browser for five minutes. */
export async function unlockNoteAction(noteId: string, typed: string): Promise<ApiResponse<{ unlocked: true }>> {
  const parsed = z.object({ noteId: id, typed: secret }).strict().safeParse({ noteId, typed });
  if (!parsed.success) return fail("VALIDATION_ERROR", "Type the password.");
  try {
    const userId = await requireUserId();
    const { key } = await lockService.unlockNote(userId, parsed.data.noteId, parsed.data.typed);
    await setUnlockCookie(userId, parsed.data.noteId, key);
    revalidatePath(`/notes/${parsed.data.noteId}`);
    return ok({ unlocked: true });
  } catch (error) {
    return toApiResponse(error);
  }
}

/** Locks the note again in this browser now, without waiting for the five minutes. */
export async function lockNowAction(noteId: string): Promise<ApiResponse<{ locked: true }>> {
  const parsed = id.safeParse(noteId);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Unknown note.");
  try {
    await requireUserId();
    await clearUnlockCookie(parsed.data);
    revalidatePath(`/notes/${parsed.data}`);
    return ok({ locked: true });
  } catch (error) {
    return toApiResponse(error);
  }
}

const LOCKED_AGAIN = "This note is locked again. Unlock it to continue.";

/** Saves the title and text of a locked note that this browser has unlocked. */
export async function saveLockedNoteAction(noteId: string, title: string, content: string): Promise<ApiResponse<{ saved: true }>> {
  const parsed = z.object({ noteId: id, title: z.string().trim().min(1).max(200), content: noteContent }).strict().safeParse({ noteId, title, content });
  if (!parsed.success) return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the title and text.");
  try {
    const userId = await requireUserId();
    const key = await unlockedKey(userId, parsed.data.noteId);
    if (!key) return fail("FORBIDDEN", LOCKED_AGAIN);
    await lockService.saveLocked(userId, parsed.data.noteId, key, { title: parsed.data.title, content: parsed.data.content });
    revalidatePath(`/notes/${parsed.data.noteId}`);
    revalidatePath("/notes");
    return ok({ saved: true });
  } catch (error) {
    return toApiResponse(error);
  }
}

/** A new password for a note this browser has unlocked. The recovery key is unchanged. */
export async function changeLockPasswordAction(noteId: string, password: string): Promise<ApiResponse<{ changed: true }>> {
  const parsed = z.object({ noteId: id, password: secret }).strict().safeParse({ noteId, password });
  if (!parsed.success) return fail("VALIDATION_ERROR", "Type the new password.");
  try {
    const userId = await requireUserId();
    const key = await unlockedKey(userId, parsed.data.noteId);
    if (!key) return fail("FORBIDDEN", LOCKED_AGAIN);
    await lockService.changeLockPassword(userId, parsed.data.noteId, key, parsed.data.password);
    return ok({ changed: true });
  } catch (error) {
    return toApiResponse(error);
  }
}

/** Takes the lock off a note this browser has unlocked: its text goes back in the note, which is indexed again. */
export async function removeLockAction(noteId: string): Promise<ApiResponse<{ removed: true }>> {
  const parsed = id.safeParse(noteId);
  if (!parsed.success) return fail("VALIDATION_ERROR", "Unknown note.");
  try {
    const userId = await requireUserId();
    const key = await unlockedKey(userId, parsed.data);
    if (!key) return fail("FORBIDDEN", LOCKED_AGAIN);
    await lockService.removeLock(userId, parsed.data, key);
    await clearUnlockCookie(parsed.data);
    revalidatePath(`/notes/${parsed.data}`);
    revalidatePath("/notes");
    return ok({ removed: true });
  } catch (error) {
    if (error instanceof AppError) return toApiResponse(error);
    return toApiResponse(error);
  }
}
