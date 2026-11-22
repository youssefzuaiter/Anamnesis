import "server-only";
import { cookies } from "next/headers";
import { config } from "@/lib/config";
import { UNLOCK_TTL_MS, openUnlock, sealUnlock, unlockCookieName } from "@/lib/unlock-cookie";

// Reading and writing the unlock cookie. This is deliberately NOT in a "use server" file: everything exported from one of those is a function the
// browser can call, and a function that returns a note's data key must never be one.

/** The data key of a locked note, if this browser holds a valid, unexpired unlock cookie for it as this user; null otherwise. */
export async function unlockedKey(userId: string, noteId: string): Promise<Buffer | null> {
  const name = unlockCookieName(noteId);
  if (!name) return null;
  const value = (await cookies()).get(name)?.value;
  return value ? openUnlock(config.NEXTAUTH_SECRET, { userId, noteId }, value, Date.now()) : null;
}

export async function setUnlockCookie(userId: string, noteId: string, key: Buffer): Promise<void> {
  const name = unlockCookieName(noteId);
  if (!name) return;
  (await cookies()).set(name, sealUnlock(config.NEXTAUTH_SECRET, { userId, noteId }, key, Date.now()), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(UNLOCK_TTL_MS / 1000),
  });
}

export async function clearUnlockCookie(noteId: string): Promise<void> {
  const name = unlockCookieName(noteId);
  if (name) (await cookies()).delete(name);
}

