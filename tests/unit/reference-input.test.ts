import { test } from "node:test";
import assert from "node:assert/strict";
import { namesFromLines, namesToLines, referenceFromForm, referenceSchema } from "@/lib/reference-input";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};
const message = (input: unknown) => {
  const parsed = referenceSchema.safeParse(input);
  return parsed.success ? null : parsed.error.issues[0].message;
};

test("a year that is not a number, or a type that does not exist, is refused in plain words", () => {
  for (const year of ["20x", "1e3", "-5", "99999"]) {
    assert.equal(message(referenceFromForm(form({ type: "article", key: "k", title: "T", year }))), "Use a year between 1000 and 2100.", year);
  }
  assert.equal(message(referenceFromForm(form({ type: "poem", key: "k", title: "T" }))), "Choose a type from the list.");
});

test("the form gives fields, names one per line, and drops a degree for anything but a thesis", () => {
  const fields = referenceFromForm(form({ type: "book", key: "k", title: "T", authors: "Doe, Jane\n{World Health Organization}\n\nAda Lovelace", year: "2020", degree: "masters", publisher: " P " }));
  assert.deepEqual(fields, {
    key: "k", type: "book", title: "T", year: 2020, publisher: "P",
    authors: [{ family: "Doe", given: "Jane" }, { literal: "World Health Organization" }, { family: "Lovelace", given: "Ada" }],
  });
  assert.equal(message(fields), null);
  assert.equal(namesToLines(namesFromLines("Doe, Jane\n{WHO}")), "Doe, Jane\n{WHO}");
});
