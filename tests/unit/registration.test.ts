import { test } from "node:test";
import assert from "node:assert/strict";
import { registrationMode, codeMatches, registrationCode, MIN_CODE_LENGTH } from "@/lib/registration";

test("the first account needs no code; after it, a code if one is set, else closed", () => {
  assert.equal(registrationMode(0, undefined), "open");
  assert.equal(registrationMode(0, "a-long-invite-code-123"), "open");
  assert.equal(registrationMode(1, undefined), "closed");
  assert.equal(registrationMode(5, "a-long-invite-code-123"), "code");
});

test("a code matches only exactly, and nothing that is not a string matches", () => {
  const code = "a-long-invite-code-123";
  assert.equal(codeMatches(code, code), true);
  assert.equal(codeMatches(` ${code} `, code), true, "spaces around a pasted code are ignored");
  for (const given of [code.toUpperCase(), code.slice(0, -1), `${code}x`, "", null, undefined, 42, [code]]) {
    assert.equal(codeMatches(given, code), false, String(given));
  }
});

test("the setting: unset or blank means no code; a short one is refused at start-up", () => {
  assert.equal(registrationCode.parse(undefined), undefined);
  assert.equal(registrationCode.parse(""), undefined);
  assert.equal(registrationCode.parse("   "), undefined);
  assert.equal(registrationCode.parse("  a-long-invite-code-123 "), "a-long-invite-code-123");
  assert.equal(MIN_CODE_LENGTH, 16);
  assert.throws(() => registrationCode.parse("x".repeat(15)));
  assert.equal(registrationCode.parse("x".repeat(16)), "x".repeat(16));
});
