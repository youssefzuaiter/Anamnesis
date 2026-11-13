import { test } from "node:test";
import assert from "node:assert/strict";
import { base32Encode, base32Decode, hotp, totp, verifyTotp, newSecret, otpauthUri, STEP_SECONDS } from "@/lib/totp";

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890" (the 8-digit table, last 6 digits).
const RFC_SECRET = Buffer.from("12345678901234567890");
const vectors: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];
for (const [time, code] of vectors) {
  test(`RFC 6238 vector at ${time}`, () => assert.equal(totp(RFC_SECRET, time * 1000), code));
}

test("RFC 4226 counter vectors (HOTP)", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, counter) => assert.equal(hotp(RFC_SECRET, counter), code));
});

test("base32 round trips and matches the RFC 4648 vectors", () => {
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.deepEqual(base32Decode("MZXW6YTBOI"), Buffer.from("foobar"));
  assert.deepEqual(base32Decode("mzxw 6ytb-oi"), Buffer.from("foobar"), "case, spaces and hyphens are ignored");
  for (let n = 0; n < 40; n++) {
    const bytes = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 255));
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  }
  assert.equal(base32Decode("not base32 !!"), null);
  assert.equal(base32Decode("1"), null);
});

test("a new secret is 20 random bytes", () => {
  const a = newSecret();
  assert.equal(a.length, 20);
  assert.notDeepEqual(a, newSecret());
});

test("a code is accepted one step either side and no further, and each step only once", () => {
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 1000 / STEP_SECONDS);
  const at = (delta: number) => totp(RFC_SECRET, now + delta * STEP_SECONDS * 1000);
  assert.equal(verifyTotp(RFC_SECRET, at(0), now, null), step);
  assert.equal(verifyTotp(RFC_SECRET, at(-1), now, null), step - 1);
  assert.equal(verifyTotp(RFC_SECRET, at(1), now, null), step + 1);
  assert.equal(verifyTotp(RFC_SECRET, at(-2), now, null), null);
  assert.equal(verifyTotp(RFC_SECRET, at(2), now, null), null);
  // Replay: a step at or before the last accepted one never passes again.
  assert.equal(verifyTotp(RFC_SECRET, at(0), now, step), null);
  assert.equal(verifyTotp(RFC_SECRET, at(-1), now, step), null);
  assert.equal(verifyTotp(RFC_SECRET, at(1), now, step), step + 1);
});

test("only exactly six digits count; spaces from a copied code are ignored", () => {
  const now = 1_700_000_000_000;
  const good = totp(RFC_SECRET, now);
  assert.notEqual(verifyTotp(RFC_SECRET, `${good.slice(0, 3)} ${good.slice(3)}`, now, null), null);
  for (const bad of ["", "12345", `${good}0`, `0${good}`, "abcdef", good.replace(/\d$/, "x"), "１２３４５６"]) {
    assert.equal(verifyTotp(RFC_SECRET, bad, now, null), null, JSON.stringify(bad));
  }
  for (const bad of [undefined, null, 123456, [good], {}]) assert.equal(verifyTotp(RFC_SECRET, bad, now, null), null);
});

test("the setup address carries the issuer, the account and the secret, and escapes them", () => {
  const uri = otpauthUri({ secret: Buffer.from("foobar"), account: "a b@x.test", issuer: "Anamnesis" });
  assert.equal(uri, "otpauth://totp/Anamnesis:a%20b%40x.test?secret=MZXW6YTBOI&issuer=Anamnesis&algorithm=SHA1&digits=6&period=30");
});
