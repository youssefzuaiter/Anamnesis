import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Encrypts a small secret (a TOTP key) for storage: AES-256-GCM under a key derived from the app's
 * `NEXTAUTH_SECRET`, so a database dump or a backup alone cannot read it. Format `v1.<nonce>.<text>.<tag>`
 * (base64url). `open` returns null for anything that does not open (wrong key, tampering, junk); callers
 * treat that as "no usable secret", never as a crash.
 */
const keyFor = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "anamnesis", "two-factor-secret", 32));
const b64 = (bytes: Buffer) => bytes.toString("base64url");

export function seal(plain: Buffer, secret: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), nonce);
  const text = Buffer.concat([cipher.update(plain), cipher.final()]);
  return ["v1", b64(nonce), b64(text), b64(cipher.getAuthTag())].join(".");
}

export function open(sealed: string, secret: string): Buffer | null {
  const [version, nonce, text, tag, extra] = sealed.split(".");
  if (version !== "v1" || !nonce || !text || !tag || extra !== undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), Buffer.from(nonce, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(text, "base64url")), decipher.final()]);
  } catch {
    return null;
  }
}
