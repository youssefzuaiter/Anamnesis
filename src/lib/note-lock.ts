// Locked notes (ROADMAP item 58): the cryptography, pure and with no database. A locked note's `content` column holds only the envelope made here.
//
// Design: the note is encrypted with a random 256-bit data key (AES-256-GCM). That key is wrapped twice, once under a key derived from the password
// (scrypt) and once under a key derived from a recovery key shown to the person once. So the password can change without re-encrypting the text, and
// forgetting it is survivable only with the recovery key: nothing else, including this server and its backups, can read the note. Every piece is bound
// to the owner and the note (the AAD), so ciphertext moved to another note or account does not open, and any changed byte fails the GCM check.

import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, type ScryptOptions } from "node:crypto";

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;
const PREFIX = "nxl1:";
/** The only cost an envelope may carry. A stored value is never trusted to set how much work is done. */
const KDF = { N: 32_768, r: 8, p: 1 } as const;
const KEY_BYTES = 32;

type Part = { iv: string; tag: string; ct: string };
type Wrap = Part & { salt: string };
type Envelope = { v: 1; kdf: typeof KDF; wraps: { password: Wrap; recovery: Wrap }; content: Part };
export type Ids = { userId: string; noteId: string };

const b64 = (buffer: Buffer) => buffer.toString("base64");
const unb64 = (text: string) => Buffer.from(text, "base64");
const aad = (label: string, ids: Ids) => Buffer.from(`nxl1|${label}|${ids.userId}|${ids.noteId}`);

function derive(secret: string, salt: Buffer): Promise<Buffer> {
  const options: ScryptOptions = { ...KDF, maxmem: 128 * KDF.N * KDF.r * 2 };
  return new Promise((resolve, reject) => scryptCallback(secret.normalize("NFKC"), salt, KEY_BYTES, options, (error, key) => (error ? reject(error) : resolve(key))));
}

function encrypt(key: Buffer, plain: Buffer, additional: Buffer): Part {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(additional);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv: b64(iv), tag: b64(cipher.getAuthTag()), ct: b64(ct) };
}

function decrypt(key: Buffer, part: Part, additional: Buffer): Buffer | null {
  try {
    const iv = unb64(part.iv);
    const tag = unb64(part.tag);
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(additional);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(unb64(part.ct)), decipher.final()]);
  } catch {
    return null;
  }
}

export const isLockedEnvelope = (content: string): boolean => content.startsWith(PREFIX);

function parse(text: string): Envelope | null {
  if (!isLockedEnvelope(text)) return null;
  try {
    const body = JSON.parse(Buffer.from(text.slice(PREFIX.length), "base64url").toString("utf8")) as Envelope;
    const partOk = (p: unknown): p is Part => !!p && typeof p === "object" && ["iv", "tag", "ct"].every((k) => typeof (p as Record<string, unknown>)[k] === "string");
    const wrapOk = (w: unknown): w is Wrap => partOk(w) && typeof (w as Wrap).salt === "string";
    if (body.v !== 1 || body.kdf?.N !== KDF.N || body.kdf?.r !== KDF.r || body.kdf?.p !== KDF.p) return null;
    return wrapOk(body.wraps?.password) && wrapOk(body.wraps?.recovery) && partOk(body.content) ? body : null;
  } catch {
    return null;
  }
}

const stringify = (envelope: Envelope): string => PREFIX + Buffer.from(JSON.stringify(envelope)).toString("base64url");

export function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD) throw new Error(`The password must be at least ${MIN_PASSWORD} characters.`);
  if (password.length > MAX_PASSWORD) throw new Error(`The password must be at most ${MAX_PASSWORD} characters.`);
}

const RECOVERY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 20 random bytes as eight groups of four letters and digits: 160 bits, readable aloud and on paper. */
export function newRecoveryKey(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join("-");
}

const normaliseRecovery = (text: string): string => text.toUpperCase().replace(/[\s-]/g, "");
const looksLikeRecovery = (text: string): boolean => /^[A-Z2-7]{32}$/.test(normaliseRecovery(text));

async function wrapKey(secret: string, key: Buffer, label: string, ids: Ids): Promise<Wrap> {
  const salt = randomBytes(16);
  const kek = await derive(secret, salt);
  return { salt: b64(salt), ...encrypt(kek, key, aad(label, ids)) };
}

async function unwrapKey(secret: string, wrap: Wrap, label: string, ids: Ids): Promise<Buffer | null> {
  const kek = await derive(secret, unb64(wrap.salt));
  const key = decrypt(kek, wrap, aad(label, ids));
  return key && key.length === KEY_BYTES ? key : null;
}

/** Encrypts a note's text under a new data key wrapped by the password and by a new recovery key (returned once, never stored). */
export async function sealNote(plaintext: string, password: string, ids: Ids): Promise<{ envelope: string; recoveryKey: string }> {
  checkPassword(password);
  const key = randomBytes(KEY_BYTES);
  const recoveryKey = newRecoveryKey();
  const [pw, rec] = await Promise.all([wrapKey(password, key, "wrap-password", ids), wrapKey(normaliseRecovery(recoveryKey), key, "wrap-recovery", ids)]);
  const envelope: Envelope = { v: 1, kdf: KDF, wraps: { password: pw, recovery: rec }, content: encrypt(key, Buffer.from(plaintext, "utf8"), aad("content", ids)) };
  return { envelope: stringify(envelope), recoveryKey };
}

/** Opens with the password or the recovery key. Null for a wrong secret and for an envelope that is damaged, forged or belongs to another note. */
export async function openWithSecret(text: string, secret: string, ids: Ids): Promise<{ plaintext: string; key: Buffer } | null> {
  const envelope = parse(text);
  if (!envelope || secret.length === 0 || secret.length > MAX_PASSWORD) return null;
  let key = await unwrapKey(secret, envelope.wraps.password, "wrap-password", ids);
  if (!key && looksLikeRecovery(secret)) key = await unwrapKey(normaliseRecovery(secret), envelope.wraps.recovery, "wrap-recovery", ids);
  if (!key) return null;
  const plaintext = openWithKey(text, key, ids);
  return plaintext === null ? null : { plaintext, key };
}

/** Opens with a data key already in hand (the unlock cookie); synchronous, no password work. */
export function openWithKey(text: string, key: Buffer, ids: Ids): string | null {
  const envelope = parse(text);
  if (!envelope || key.length !== KEY_BYTES) return null;
  const plain = decrypt(key, envelope.content, aad("content", ids));
  return plain === null ? null : plain.toString("utf8");
}

/** New text under the same data key and wraps, with a fresh nonce. */
export function resealWithKey(text: string, key: Buffer, plaintext: string, ids: Ids): string {
  const envelope = parse(text);
  if (!envelope) throw new Error("Not a locked note.");
  return stringify({ ...envelope, content: encrypt(key, Buffer.from(plaintext, "utf8"), aad("content", ids)) });
}

/** A new password for the same data key; the text, the recovery wrap and the recovery key are unchanged. */
export async function rewrapPassword(text: string, key: Buffer, password: string, ids: Ids): Promise<string> {
  checkPassword(password);
  const envelope = parse(text);
  if (!envelope) throw new Error("Not a locked note.");
  return stringify({ ...envelope, wraps: { ...envelope.wraps, password: await wrapKey(password, key, "wrap-password", ids) } });
}
