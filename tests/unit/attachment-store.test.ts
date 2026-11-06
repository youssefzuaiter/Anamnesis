import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedType,
  allowedTypeList,
  getAttachment,
  deleteAttachment,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/attachment-store";
import { AppError } from "@/lib/api-response";

test("images, PDFs and plain text are allowed", () => {
  assert.equal(isAllowedType("image/png"), true);
  assert.equal(isAllowedType("application/pdf"), true);
  assert.equal(isAllowedType("text/plain"), true);
});

test("anything the browser could execute in this origin is refused", () => {
  // Not just "not on the list" — these are the specific types the allowlist
  // exists to keep out, per lib/attachment-store.ts's own stated reasoning.
  assert.equal(isAllowedType("text/html"), false);
  assert.equal(isAllowedType("image/svg+xml"), false);
  assert.equal(isAllowedType("application/javascript"), false);
});

test("the allowed list and the type check agree with each other", () => {
  for (const type of allowedTypeList()) {
    assert.equal(isAllowedType(type), true, type);
  }
});

test("the size cap is 10MB", () => {
  assert.equal(MAX_ATTACHMENT_BYTES, 10 * 1024 * 1024);
});

test("a key that isn't the generated uuid.ext shape is refused before any file read", async () => {
  // Never touches the filesystem for these — the regex check happens first,
  // which is what makes a path-traversal attempt ("../../.env") safe to
  // reject without it ever reaching fs.readFile.
  await assert.rejects(
    () => getAttachment("../../../etc/passwd"),
    (error: unknown) => error instanceof AppError && error.code === "RESOURCE_NOT_FOUND",
  );
});

test("a malformed key is silently ignored on delete, not passed to fs.unlink", async () => {
  // deleteAttachment never throws — a bad key just means nothing happens.
  await assert.doesNotReject(() => deleteAttachment("../../../etc/passwd"));
  await assert.doesNotReject(() => deleteAttachment("not-a-real-key"));
});

test("names that exist on every object are not file types", () => {
  // The type comes from the browser (`file.type`), which will send any string.
  // `"toString" in {}` is true, so a lookup written as `in` accepted these and
  // then built a stored file name out of an inherited function.
  for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
    assert.equal(isAllowedType(name), false, name);
  }
});
