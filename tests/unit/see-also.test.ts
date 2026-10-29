import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendSeeAlso,
  canLinkTitle,
  linksTo,
  MAX_NOTE_LENGTH,
  SEE_ALSO_HEADING,
} from "@/lib/see-also";

test("the heading and the length limit are the editor's own", () => {
  assert.equal(SEE_ALSO_HEADING, "See also");
  assert.equal(MAX_NOTE_LENGTH, 100_000);
});

test("canLinkTitle accepts ordinary titles, including punctuation and non-Latin letters", () => {
  assert.equal(canLinkTitle("Gradient descent"), true);
  assert.equal(canLinkTitle("C++ (basics)"), true);
  assert.equal(canLinkTitle("Lecture 4 · Backpropagation"), true);
  assert.equal(canLinkTitle("Öğrenme oranı"), true);
  assert.equal(canLinkTitle("x".repeat(200)), true);
});

test("canLinkTitle refuses a title that cannot be written as [[...]]", () => {
  assert.equal(canLinkTitle(""), false);
  assert.equal(canLinkTitle("   "), false);
  assert.equal(canLinkTitle("a[b"), false);
  assert.equal(canLinkTitle("a]b"), false);
  assert.equal(canLinkTitle("a\nb"), false);
  assert.equal(canLinkTitle("a\r\nb"), false);
  assert.equal(canLinkTitle("x".repeat(201)), false);
});

test("linksTo matches the way the app resolves a link, ignoring case and spacing", () => {
  assert.equal(linksTo("See [[Gradient descent]].", "Gradient descent"), true);
  assert.equal(linksTo("See [[ gradient   DESCENT ]].", "Gradient descent"), true);
  assert.equal(linksTo("See [[Gradient descent intro]].", "Gradient descent"), false);
  assert.equal(linksTo("See gradient descent.", "Gradient descent"), false);
  assert.equal(linksTo("", "Gradient descent"), false);
});

test("linksTo does not stop at the 50 links the index follows", () => {
  const many = Array.from({ length: 60 }, (_, i) => `[[Note ${i}]]`).join(" ");
  assert.equal(linksTo(many, "Note 59"), true);
});

test("a note with no section gets a See also section at the end", () => {
  assert.deepEqual(appendSeeAlso("Intro.\n", "X"), {
    content: "Intro.\n\n## See also\n\n- [[X]]\n",
    added: true,
  });
});

test("trailing newlines do not change where the section starts", () => {
  const expected = "Intro.\n\n## See also\n\n- [[X]]\n";
  assert.equal(appendSeeAlso("Intro.", "X").content, expected);
  assert.equal(appendSeeAlso("Intro.\n\n\n", "X").content, expected);
  assert.equal(appendSeeAlso("Intro.\n  \n \n", "X").content, expected);
});

test("an empty note gets the section with no leading blank lines", () => {
  assert.equal(appendSeeAlso("", "X").content, "## See also\n\n- [[X]]\n");
  assert.equal(appendSeeAlso("\n \n", "X").content, "## See also\n\n- [[X]]\n");
});

test("an existing See also section at the end gets the bullet after its last one", () => {
  const before = "Intro.\n\n## See also\n\n- [[A]]\n- [[B]]\n";
  assert.equal(
    appendSeeAlso(before, "X").content,
    "Intro.\n\n## See also\n\n- [[A]]\n- [[B]]\n- [[X]]\n",
  );
});

test("an existing section followed by another heading gets the bullet before it", () => {
  const before = "## See also\n\n- [[A]]\n\n## Next\n\nText.\n";
  assert.equal(
    appendSeeAlso(before, "X").content,
    "## See also\n\n- [[A]]\n- [[X]]\n\n## Next\n\nText.\n",
  );
});

test("an empty See also section gets a blank line before the bullet", () => {
  assert.equal(
    appendSeeAlso("Intro.\n\n## See also\n", "X").content,
    "Intro.\n\n## See also\n\n- [[X]]\n",
  );
  assert.equal(
    appendSeeAlso("## See also\n\n## Next\n", "X").content,
    "## See also\n\n- [[X]]\n\n## Next\n",
  );
});

test("the heading is recognised in any case and with trailing spaces", () => {
  assert.equal(
    appendSeeAlso("## see also  \n\n- [[A]]\n", "X").content,
    "## see also  \n\n- [[A]]\n- [[X]]\n",
  );
});

test("a See also heading inside a code block is not a section", () => {
  const before = "```md\n## See also\n\n- [[A]]\n```\n";
  assert.equal(
    appendSeeAlso(before, "X").content,
    "```md\n## See also\n\n- [[A]]\n```\n\n## See also\n\n- [[X]]\n",
  );
});

test("a link that is already there is not added again", () => {
  const before = "Intro.\n\nSee [[ x ]] too.\n";
  assert.deepEqual(appendSeeAlso(before, "X"), { content: before, added: false });
});

test("an unterminated code fence is closed first, so the section is not inside it", () => {
  assert.equal(
    appendSeeAlso("```js\ncode\n", "X").content,
    "```js\ncode\n```\n\n## See also\n\n- [[X]]\n",
  );
  assert.equal(
    appendSeeAlso("~~~\ncode", "X").content,
    "~~~\ncode\n~~~\n\n## See also\n\n- [[X]]\n",
  );
});

test("a longer fence is closed with a fence at least as long", () => {
  assert.equal(
    appendSeeAlso("````\n```\ninner\n", "X").content,
    "````\n```\ninner\n````\n\n## See also\n\n- [[X]]\n",
  );
});

test("a balanced fence is left alone", () => {
  assert.equal(
    appendSeeAlso("```js\ncode\n```\n", "X").content,
    "```js\ncode\n```\n\n## See also\n\n- [[X]]\n",
  );
});

test("a section that ends inside an open fence gets its bullet after the closing fence", () => {
  assert.equal(
    appendSeeAlso("## See also\n\n```\nfoo\n", "X").content,
    "## See also\n\n```\nfoo\n```\n- [[X]]\n",
  );
});

test("Windows line endings are kept", () => {
  assert.equal(
    appendSeeAlso("Intro.\r\n", "X").content,
    "Intro.\r\n\r\n## See also\r\n\r\n- [[X]]\r\n",
  );
  assert.equal(
    appendSeeAlso("## See also\r\n\r\n- [[A]]\r\n", "X").content,
    "## See also\r\n\r\n- [[A]]\r\n- [[X]]\r\n",
  );
});

test("a title with punctuation is written as it is", () => {
  assert.equal(
    appendSeeAlso("Intro.", "C++ (basics)").content,
    "Intro.\n\n## See also\n\n- [[C++ (basics)]]\n",
  );
});

test("surrounding spaces in the title are not written", () => {
  assert.equal(
    appendSeeAlso("Intro.", "  X  ").content,
    "Intro.\n\n## See also\n\n- [[X]]\n",
  );
});

test("whatever it writes, the note then links to the title", () => {
  const samples = [
    "",
    "Intro.",
    "Intro.\n\n## See also\n\n- [[A]]\n",
    "```\nunterminated",
    "# Title\n\n## See also\n\n## Other\n",
    "a\r\nb\r\n",
  ];
  for (const sample of samples) {
    const result = appendSeeAlso(sample, "Gradient descent");
    assert.equal(result.added, true, sample);
    assert.equal(linksTo(result.content, "Gradient descent"), true, sample);
    assert.ok(result.content.endsWith("\n") && !result.content.endsWith("\n\n"), sample);
  }
});

test("a title that cannot be a link is a programming error, not an edit", () => {
  assert.throws(() => appendSeeAlso("Intro.", "a]b"));
  assert.throws(() => appendSeeAlso("Intro.", ""));
});
