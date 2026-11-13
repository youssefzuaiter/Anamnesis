import { test } from "node:test";
import assert from "node:assert/strict";
import { seal, open } from "@/lib/secret-box";

const key = "k".repeat(40);
test("a sealed value opens with the same key and not with another", () => {
  const sealed = seal(Buffer.from("twenty bytes of data"), key);
  assert.deepEqual(open(sealed, key), Buffer.from("twenty bytes of data"));
  assert.equal(open(sealed, "j".repeat(40)), null);
});
test("sealing twice gives different text (a fresh nonce), and tampering is refused", () => {
  const a = seal(Buffer.from("x"), key);
  assert.notEqual(a, seal(Buffer.from("x"), key));
  const flipped = a.slice(0, -2) + (a.endsWith("A") ? "B" : "A") + a.slice(-1);
  assert.equal(open(flipped, key), null);
  for (const junk of ["", "v1", "v1.x", "v2.AAAA.AAAA.AAAA", "not sealed at all"]) assert.equal(open(junk, key), null, junk);
});
