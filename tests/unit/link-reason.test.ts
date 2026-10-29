import { test } from "node:test";
import assert from "node:assert/strict";
import { reasonLine } from "@/lib/link-reason";

test("a note offered by name says so", () => {
  assert.equal(reasonLine(["named"], null), "Named in this note");
});

test("a note offered by meaning shows how close, to two places", () => {
  assert.equal(reasonLine(["similar"], 0.7821), "Close in meaning · 0.78");
  assert.equal(reasonLine(["similar"], 0.7), "Close in meaning · 0.70");
});

test("both reasons are joined, name first", () => {
  assert.equal(
    reasonLine(["named", "similar"], 0.95),
    "Named in this note · Close in meaning · 0.95",
  );
});

test("a similar note with no score still reads", () => {
  assert.equal(reasonLine(["similar"], null), "Close in meaning");
});
