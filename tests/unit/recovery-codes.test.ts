import { test } from "node:test";
import assert from "node:assert/strict";
import { newRecoveryCodes, normaliseRecoveryCode, hashRecoveryCode, looksLikeRecoveryCode, RECOVERY_CODE_COUNT } from "@/lib/recovery-codes";

test("ten distinct codes of four groups of four", () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, RECOVERY_CODE_COUNT);
  assert.equal(new Set(codes).size, RECOVERY_CODE_COUNT);
  for (const code of codes) assert.match(code, /^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/);
});
test("a typed code is normalised: case, spaces and hyphens do not matter", () => {
  assert.equal(normaliseRecoveryCode(" ABCD efgh-2345  6abc "), "abcdefgh23456abc");
  assert.equal(hashRecoveryCode("ABCD-EFGH-2345-6ABC"), hashRecoveryCode("abcdefgh23456abc"));
  assert.notEqual(hashRecoveryCode("abcd-efgh-2345-6abc"), hashRecoveryCode("abcd-efgh-2345-6abd"));
  assert.match(hashRecoveryCode("abcd-efgh-2345-6abc"), /^[0-9a-f]{64}$/);
});
test("only a sixteen-character code is worth looking up", () => {
  assert.equal(looksLikeRecoveryCode("abcd-efgh-2345-6abc"), true);
  for (const bad of ["", "123456", "abcd-efgh-2345", "abcd-efgh-2345-6abc-d", "abcd-efgh-2345-6ab!", 5, null, undefined]) assert.equal(looksLikeRecoveryCode(bad), false, String(bad));
});
