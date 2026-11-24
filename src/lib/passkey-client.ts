// The browser half of passkey unlock (ROADMAP item 58, follow-up). Nothing here runs on the server. A passkey is made once; later, the authenticator
// (Touch ID, a security key) derives a 32-byte secret from a salt with the WebAuthn PRF extension, after the person verifies. That secret is what the
// server wraps a note's key under. Registration and unlocking are not "sign-ins": no assertion is sent to be verified, only the derived secret.

const b64u = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64u = (text: string): Uint8Array<ArrayBuffer> => {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
};
const random = (length: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)));

export const supportsPasskeys = (): boolean => typeof window !== "undefined" && typeof PublicKeyCredential !== "undefined" && typeof navigator.credentials?.create === "function";

export class PasskeyError extends Error {}

/** Asks the device to make a passkey that can derive a secret. Returns what the server may keep: its credential id and the salt to use with it. */
export async function createPasskey(label: string): Promise<{ credentialId: string; prfSalt: string }> {
  if (!supportsPasskeys()) throw new PasskeyError("This browser cannot make a passkey.");
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        rp: { name: "Anamnesis" },
        user: { id: random(16), name: "anamnesis", displayName: label.slice(0, 60) || "Anamnesis" },
        challenge: random(32),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
        timeout: 60_000,
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      },
    });
  } catch {
    throw new PasskeyError("The passkey was not made. It may have been cancelled.");
  }
  if (!(credential instanceof PublicKeyCredential)) throw new PasskeyError("The passkey was not made.");
  const results = credential.getClientExtensionResults() as { prf?: { enabled?: boolean } };
  if (results.prf?.enabled !== true) throw new PasskeyError("This device or browser cannot use a passkey to unlock notes (it does not support the PRF extension).");
  return { credentialId: b64u(credential.rawId), prfSalt: b64u(random(32)) };
}

export type KnownPasskey = { id: string; credentialId: string; prfSalt: string };

/** Asks for one of these passkeys (the person verifies) and returns which one answered and its secret, as base64url. */
export async function derivePasskeySecret(candidates: KnownPasskey[]): Promise<{ id: string; secret: string }> {
  if (!supportsPasskeys() || candidates.length === 0) throw new PasskeyError("This browser cannot use a passkey.");
  const evalByCredential: Record<string, { first: Uint8Array<ArrayBuffer> }> = {};
  for (const c of candidates) evalByCredential[c.credentialId] = { first: fromB64u(c.prfSalt) };
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: candidates.map((c) => ({ type: "public-key", id: fromB64u(c.credentialId) })),
        userVerification: "required",
        timeout: 60_000,
        extensions: { prf: { evalByCredential } } as AuthenticationExtensionsClientInputs,
      },
    });
  } catch {
    throw new PasskeyError("The passkey was not used. It may have been cancelled.");
  }
  if (!(credential instanceof PublicKeyCredential)) throw new PasskeyError("The passkey was not used.");
  const answered = candidates.find((c) => c.credentialId === b64u(credential.rawId));
  const first = (credential.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
  if (!answered || !first || first.byteLength !== 32) throw new PasskeyError("This passkey could not derive the secret. Use the password instead.");
  return { id: answered.id, secret: b64u(first) };
}
