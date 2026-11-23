import { test } from "node:test";
import assert from "node:assert/strict";
import { lockVia, sealNote, openWithSecret, openWithKey, resealWithKey, rewrapPassword, isLockedEnvelope, newRecoveryKey, MIN_PASSWORD } from "@/lib/note-lock";

const ids = { userId: "u1", noteId: "n1" };
const PW = "correct horse battery";
const TEXT = "Secret note with $x^2$ and café ☕ and a long tail. ".repeat(40);

test("a sealed note opens with its password or its recovery key and with nothing else", async () => {
  const { envelope, recoveryKey } = await sealNote(TEXT, PW, ids);
  assert.ok(isLockedEnvelope(envelope));
  assert.ok(!envelope.includes("Secret"), "no plaintext in the stored text");
  const byPassword = await openWithSecret(envelope, PW, ids);
  assert.equal(byPassword?.plaintext, TEXT);
  const byRecovery = await openWithSecret(envelope, recoveryKey, ids);
  assert.equal(byRecovery?.plaintext, TEXT);
  assert.deepEqual(byRecovery?.key, byPassword?.key, "both open the same data key");
  for (const wrong of ["correct horse batterY", "", PW + " ", recoveryKey.slice(0, -1) + (recoveryKey.endsWith("A") ? "B" : "A")]) assert.equal(await openWithSecret(envelope, wrong, ids), null, wrong);
});

test("the password is normalised, so the same word typed another way opens it", async () => {
  const { envelope } = await sealNote("x", "pässwörd-long-enough", ids);
  assert.ok(await openWithSecret(envelope, "pässwörd-long-enough", ids));
});

test("a sealed note is bound to its owner and its note: moved elsewhere it does not open", async () => {
  const { envelope } = await sealNote(TEXT, PW, ids);
  assert.equal(await openWithSecret(envelope, PW, { userId: "u2", noteId: "n1" }), null);
  assert.equal(await openWithSecret(envelope, PW, { userId: "u1", noteId: "n2" }), null);
  const opened = await openWithSecret(envelope, PW, ids);
  assert.equal(openWithKey(envelope, opened!.key, { userId: "u1", noteId: "n2" }), null);
});

test("every sealing is different: a fresh salt and nonce each time, and the same text does not repeat", async () => {
  const a = await sealNote(TEXT, PW, ids);
  const b = await sealNote(TEXT, PW, ids);
  assert.notEqual(a.envelope, b.envelope);
  assert.notEqual(a.recoveryKey, b.recoveryKey);
  const k = (await openWithSecret(a.envelope, PW, ids))!.key;
  const again = resealWithKey(a.envelope, k, TEXT, ids);
  assert.notEqual(again, a.envelope, "a new nonce for the same text");
  assert.equal(openWithKey(again, k, ids), TEXT);
});

test("tampering with any part is refused, never read as text", async () => {
  const { envelope } = await sealNote("hello there", PW, ids);
  const body = JSON.parse(Buffer.from(envelope.slice(5), "base64url").toString());
  const mutate = (f: (b: typeof body) => void) => { const c = structuredClone(body); f(c); return "nxl1:" + Buffer.from(JSON.stringify(c)).toString("base64url"); };
  const flip = (s: string) => Buffer.from(Buffer.from(s, "base64").map((x, i) => (i === 0 ? x ^ 1 : x))).toString("base64");
  for (const bad of [
    mutate((b) => { b.content.ct = flip(b.content.ct); }),
    mutate((b) => { b.content.tag = flip(b.content.tag); }),
    mutate((b) => { b.content.iv = flip(b.content.iv); }),
    mutate((b) => { b.wraps.password.ct = flip(b.wraps.password.ct); }),
    mutate((b) => { b.wraps.password.salt = flip(b.wraps.password.salt); }),
    mutate((b) => { b.kdf.N = 16384; }),
    "nxl1:" + "A".repeat(10), "nxl1:", "garbage", "",
  ]) assert.equal(await openWithSecret(bad, PW, ids), null);
});

test("an absurd cost in a stored envelope is refused rather than spent", async () => {
  const { envelope } = await sealNote("x", PW, ids);
  const body = JSON.parse(Buffer.from(envelope.slice(5), "base64url").toString());
  body.kdf = { N: 2 ** 24, r: 8, p: 1 };
  const bad = "nxl1:" + Buffer.from(JSON.stringify(body)).toString("base64url");
  const started = Date.now();
  assert.equal(await openWithSecret(bad, PW, ids), null);
  assert.ok(Date.now() - started < 500);
});

test("changing the password rewraps the key without touching the text, and the old one stops working; the recovery key still works", async () => {
  const { envelope, recoveryKey } = await sealNote(TEXT, PW, ids);
  const { key } = (await openWithSecret(envelope, PW, ids))!;
  const next = await rewrapPassword(envelope, key, "a brand new passphrase", ids);
  assert.equal(await openWithSecret(next, PW, ids), null);
  assert.equal((await openWithSecret(next, "a brand new passphrase", ids))?.plaintext, TEXT);
  assert.equal((await openWithSecret(next, recoveryKey, ids))?.plaintext, TEXT);
});

test("a recovery key is 20 random bytes in groups, and a password must be long enough", async () => {
  const k = newRecoveryKey();
  assert.match(k, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/);
  assert.notEqual(k, newRecoveryKey());
  await assert.rejects(sealNote("x", "short", ids), /at least/);
  await assert.rejects(sealNote("x", "x".repeat(201), ids), /at most/);
  assert.equal(MIN_PASSWORD, 10);
});

test("an empty note and a 100,000-character note both round-trip", async () => {
  for (const t of ["", "é".repeat(100_000)]) {
    const { envelope } = await sealNote(t, PW, ids);
    assert.equal((await openWithSecret(envelope, PW, ids))?.plaintext, t);
  }
});

test("a lock made with the sign-in password may be short, says so on the lock screen, and is otherwise the same", async () => {
  const { envelope } = await sealNote("text", "short1", ids, "account");
  assert.equal(lockVia(envelope), "account");
  assert.equal((await openWithSecret(envelope, "short1", ids))?.plaintext, "text");
  assert.equal(await openWithSecret(envelope, "short2", ids), null);
  await assert.rejects(sealNote("x", "", ids, "account"), /at least 1/);
  await assert.rejects(sealNote("x", "short1", ids, "own"), /at least 10/);
  await assert.rejects(sealNote("x", "x".repeat(201), ids, "account"), /at most/);
});

test("a note's own password is the default, an unlabelled or damaged lock asks for it, and a new password makes the lock the note's own", async () => {
  const own = await sealNote("t", PW, ids);
  assert.equal(lockVia(own.envelope), "own");
  assert.equal(lockVia("nxl1:garbage"), "own");
  assert.equal(lockVia("plain text"), "own");
  const account = await sealNote("t", "signin1", ids, "account");
  const { key } = (await openWithSecret(account.envelope, "signin1", ids))!;
  const changed = await rewrapPassword(account.envelope, key, "a brand new passphrase", ids);
  assert.equal(lockVia(changed), "own");
  assert.equal((await openWithSecret(changed, "a brand new passphrase", ids))?.plaintext, "t");
});
