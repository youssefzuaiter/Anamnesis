// Locked notes (ROADMAP item 58): the cryptography, pure and with no database. A locked note's `content` column holds only the envelope made here.
//
// Design: the note is encrypted with a random 256-bit data key (AES-256-GCM). That key is wrapped twice, once under a key derived from the password
// (scrypt) and once under a key derived from a recovery key shown to the person once. So the password can change without re-encrypting the text, and
// forgetting it is survivable only with the recovery key: nothing else, including this server and its backups, can read the note. Every piece is bound
// to the owner and the note (the AAD), so ciphertext moved to another note or account does not open, and any changed byte fails the GCM check.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt as scryptCallback, type ScryptOptions } from "node:crypto";

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;
const PREFIX = "nxl1:";
/** The only cost an envelope may carry. A stored value is never trusted to set how much work is done. */
const KDF = { N: 32_768, r: 8, p: 1 } as const;
const KEY_BYTES = 32;

type Part = { iv: string; tag: string; ct: string };
type Wrap = Part & { salt: string };
/** `via` is only a label for the lock screen ("your sign-in password" or "this note's password"): it is not authenticated and decides nothing. */
export type LockVia = "account" | "own";
/** One passkey's wrap. A list, not an object keyed by the passkey's id, so no property name is ever taken from a value. */
type PasskeyWrap = Part & { id: string };
type Envelope = { v: 1; kdf: typeof KDF; via?: LockVia; wraps: { password: Wrap; recovery: Wrap; passkeys?: PasskeyWrap[] }; content: Part };
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
    const passkeys = body.wraps?.passkeys;
    if (passkeys !== undefined && (!Array.isArray(passkeys) || passkeys.length > 50 || passkeys.some((p) => !partOk(p) || typeof (p as PasskeyWrap).id !== "string"))) return null;
    return wrapOk(body.wraps?.password) && wrapOk(body.wraps?.recovery) && partOk(body.content) ? body : null;
  } catch {
    return null;
  }
}

const stringify = (envelope: Envelope): string => PREFIX + Buffer.from(JSON.stringify(envelope)).toString("base64url");

/** A separate note password must be at least MIN_PASSWORD long; a sign-in password was chosen under the account's own rules, so only the upper bound applies. */
export function checkPassword(password: string, minimum: number = MIN_PASSWORD): void {
  if (password.length < Math.max(1, minimum)) throw new Error(`The password must be at least ${Math.max(1, minimum)} characters.`);
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
export async function sealNote(plaintext: string, password: string, ids: Ids, via: LockVia = "own"): Promise<{ envelope: string; recoveryKey: string }> {
  checkPassword(password, via === "account" ? 1 : MIN_PASSWORD);
  const key = randomBytes(KEY_BYTES);
  const recoveryKey = newRecoveryKey();
  const [pw, rec] = await Promise.all([wrapKey(password, key, "wrap-password", ids), wrapKey(normaliseRecovery(recoveryKey), key, "wrap-recovery", ids)]);
  const envelope: Envelope = { v: 1, kdf: KDF, via, wraps: { password: pw, recovery: rec }, content: encrypt(key, Buffer.from(plaintext, "utf8"), aad("content", ids)) };
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
  return stringify({ ...envelope, via: "own", wraps: { ...envelope.wraps, password: await wrapKey(password, key, "wrap-password", ids) } });
}

/** Which password the lock screen should ask for. Read without opening anything; an envelope with no label (an older one) asks for the note's own. */
export function lockVia(text: string): LockVia {
  return parse(text)?.via === "account" ? "account" : "own";
}

// --- Passkeys (Touch ID, a security key) ----------------------------------------------------------------------------------------------------------------
// A passkey's authenticator derives a 32-byte secret (the WebAuthn PRF extension) that only that device can produce, after the person verifies with a
// fingerprint or a PIN. The browser hands the server that secret at unlock time, the way it hands over a password; the server wraps the note's data key under a
// key made from it and stores only the wrap. The secret itself is never stored.

const MIN_PASSKEY_SECRET = 16;
const passkeyKey = (secret: Uint8Array, passkeyId: string, ids: Ids): Buffer => Buffer.from(hkdfSync("sha256", secret, `${ids.userId}|${ids.noteId}`, `nxl1-passkey|${passkeyId}`, KEY_BYTES));

/** The passkeys that can open this note, from the stored text alone (their ids are not secret). */
export function passkeyIdsOf(text: string): string[] {
  return (parse(text)?.wraps.passkeys ?? []).map((wrap) => wrap.id);
}

/** Lets a passkey open this note too: the data key wrapped under that passkey's secret. Needs the data key, so the note must be unlocked. */
export function addPasskeyWrap(text: string, key: Buffer, passkeyId: string, secret: Uint8Array, ids: Ids): string {
  const envelope = parse(text);
  if (!envelope) throw new Error("Not a locked note.");
  if (key.length !== KEY_BYTES) throw new Error("The note's key is not usable.");
  if (secret.length < MIN_PASSKEY_SECRET) throw new Error("The passkey's secret is too short.");
  const wrap: PasskeyWrap = { id: passkeyId, ...encrypt(passkeyKey(secret, passkeyId, ids), key, aad(`wrap-passkey|${passkeyId}`, ids)) };
  // One wrap per passkey: a second enabling replaces the first.
  const others = (envelope.wraps.passkeys ?? []).filter((existing) => existing.id !== passkeyId);
  return stringify({ ...envelope, wraps: { ...envelope.wraps, passkeys: [...others, wrap] } });
}

/** Opens with a passkey's secret. Null for a wrong secret, a passkey with no wrap here, and anything damaged or belonging to another note. */
export function openWithPasskey(text: string, passkeyId: string, secret: Uint8Array, ids: Ids): { plaintext: string; key: Buffer } | null {
  const envelope = parse(text);
  const wrap = envelope?.wraps.passkeys?.find((existing) => existing.id === passkeyId);
  if (!envelope || !wrap || secret.length < MIN_PASSKEY_SECRET) return null;
  const key = decrypt(passkeyKey(secret, passkeyId, ids), wrap, aad(`wrap-passkey|${passkeyId}`, ids));
  if (!key || key.length !== KEY_BYTES) return null;
  const plaintext = openWithKey(text, key, ids);
  return plaintext === null ? null : { plaintext, key };
}

export function removePasskeyWrap(text: string, passkeyId: string): string {
  const envelope = parse(text);
  if (!envelope) throw new Error("Not a locked note.");
  const rest = (envelope.wraps.passkeys ?? []).filter((existing) => existing.id !== passkeyId);
  return stringify({ ...envelope, wraps: { ...envelope.wraps, passkeys: rest.length > 0 ? rest : undefined } });
}
