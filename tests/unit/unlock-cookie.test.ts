import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { sealUnlock, openUnlock, unlockCookieName, UNLOCK_TTL_MS } from "@/lib/unlock-cookie";

const secret = "s".repeat(40);
const key = randomBytes(32);
const now = 1_000_000;
const ids = { userId: "u1", noteId: "11111111-1111-4111-8111-111111111111" };

test("a data key sealed for one note and user opens for them until it expires, and not after", () => {
  const sealed = sealUnlock(secret, ids, key, now);
  assert.ok(!sealed.includes(key.toString("base64")) && !sealed.includes(key.toString("hex")), "the key is not readable in the cookie");
  assert.deepEqual(openUnlock(secret, ids, sealed, now + 1000), key);
  assert.deepEqual(openUnlock(secret, ids, sealed, now + UNLOCK_TTL_MS - 1), key);
  assert.equal(openUnlock(secret, ids, sealed, now + UNLOCK_TTL_MS), null);
  assert.equal(openUnlock(secret, ids, sealed, now - 1), null, "not from the future");
});

test("it opens for no other note, no other user and no other server secret", () => {
  const sealed = sealUnlock(secret, ids, key, now);
  assert.equal(openUnlock(secret, { ...ids, noteId: "22222222-2222-4222-8222-222222222222" }, sealed, now), null);
  assert.equal(openUnlock(secret, { ...ids, userId: "u2" }, sealed, now), null);
  assert.equal(openUnlock("t".repeat(40), ids, sealed, now), null);
});

test("a changed, truncated or invented cookie opens nothing", () => {
  const sealed = sealUnlock(secret, ids, key, now);
  const bytes = Buffer.from(sealed, "base64url");
  bytes[bytes.length - 1] ^= 1;
  for (const bad of [bytes.toString("base64url"), sealed.slice(0, -4), "", "x", "A".repeat(200)]) assert.equal(openUnlock(secret, ids, bad, now), null);
});

test("the cookie name carries the note id only when it is a real id", () => {
  assert.equal(unlockCookieName(ids.noteId), `nxu_${ids.noteId}`);
  assert.equal(unlockCookieName("../x; path=/"), null);
});
