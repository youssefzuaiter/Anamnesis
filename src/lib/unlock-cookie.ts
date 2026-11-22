// The "unlocked for a few minutes" state of a locked note (ROADMAP item 58). After the password is checked, the note's data key is sealed under a key
// derived from the server's own secret and sent back as an httpOnly cookie that names its note and owner and expires in five minutes. The database and
// its backups never hold it, and neither does the browser in a form it can read. Whoever has both the server's secret and this cookie has the key for
// that one note for those minutes, which is the limit of what server-side encryption can promise.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export const UNLOCK_TTL_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Ids = { userId: string; noteId: string };

/** The cookie's name, or null when the id is not a real note id (so a name never carries anything but one). */
export const unlockCookieName = (noteId: string): string | null => (UUID.test(noteId) ? `nxu_${noteId}` : null);

const sealingKey = (secret: string): Buffer => Buffer.from(hkdfSync("sha256", secret, "", "nexus-note-unlock-v1", 32));
const aad = (ids: Ids) => Buffer.from(`nxu|${ids.userId}|${ids.noteId}`);

export function sealUnlock(secret: string, ids: Ids, dataKey: Buffer, now: number): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(secret), iv);
  cipher.setAAD(aad(ids));
  const body = Buffer.concat([cipher.update(JSON.stringify({ k: dataKey.toString("base64"), s: now, e: now + UNLOCK_TTL_MS })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function openUnlock(secret: string, ids: Ids, sealed: string, now: number): Buffer | null {
  try {
    const bytes = Buffer.from(sealed, "base64url");
    if (bytes.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", sealingKey(secret), bytes.subarray(0, 12));
    decipher.setAAD(aad(ids));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const body = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as { k: string; s: number; e: number };
    if (typeof body.e !== "number" || typeof body.s !== "number" || now >= body.e || now < body.s) return null;
    const key = Buffer.from(body.k, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}
