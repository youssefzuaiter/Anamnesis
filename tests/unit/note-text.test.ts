import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_NOTE_LENGTH } from "@/lib/see-also";
import { noteContent, normalizeLineBreaks } from "@/lib/note-text";

// A browser sends every line break of a textarea as CR LF, so the server sees more
// characters than the person typed.
const asSubmitted = (text: string) => text.replace(/\n/g, "\r\n");

// The note that exposed this: lines of maths joined by blank lines, cut to length.
function reportedNote(length: number): string {
  const lines: string[] = [];
  for (let n = 1; n <= 3000; n++) lines.push(`Line ${n} has the value $x_{${n}}^2$ in it, ok.`);
  return lines.join("\n\n").slice(0, length);
}

function lines(length: number): string {
  return "ab\n".repeat(Math.ceil(length / 3)).slice(0, length);
}

test("CR LF and a lone CR become LF, and text with LF only is left as it is", () => {
  assert.equal(normalizeLineBreaks("a\r\nb"), "a\nb");
  assert.equal(normalizeLineBreaks("a\rb"), "a\nb");
  assert.equal(normalizeLineBreaks("a\r\n\r\nb"), "a\n\nb");
  assert.equal(normalizeLineBreaks("a\r\rb"), "a\n\nb");
  assert.equal(normalizeLineBreaks("a\n\nb"), "a\n\nb");
  assert.equal(normalizeLineBreaks(""), "");
});

test("normalising twice changes nothing more", () => {
  const once = normalizeLineBreaks("a\r\nb\rc\n\r\nd");
  assert.equal(normalizeLineBreaks(once), once);
});

test("a note the browser sends over the limit in CR LF is judged at the length that was typed", () => {
  const typed = reportedNote(99_000);
  const sent = asSubmitted(typed);
  // The reproduction itself: this note is under the limit as typed and over it as sent.
  assert.ok(typed.length < MAX_NOTE_LENGTH);
  assert.ok(sent.length > MAX_NOTE_LENGTH, `sent is ${sent.length} characters`);

  const result = noteContent.safeParse(sent);
  assert.ok(result.success, "a 99,000-character note must be accepted");
  assert.equal(result.data, typed);
});

test("the stored text has LF line breaks only", () => {
  const result = noteContent.safeParse("one\r\ntwo\rthree\nfour");
  assert.ok(result.success);
  assert.equal(result.data, "one\ntwo\nthree\nfour");
});

test("the limit is on the typed length: exactly 100,000 is kept and one more is refused", () => {
  const atLimit = lines(MAX_NOTE_LENGTH);
  assert.equal(atLimit.length, MAX_NOTE_LENGTH);
  assert.ok(noteContent.safeParse(asSubmitted(atLimit)).success);
  assert.ok(noteContent.safeParse(atLimit).success);

  const over = `${atLimit}x`;
  assert.equal(noteContent.safeParse(asSubmitted(over)).success, false);
  assert.equal(noteContent.safeParse(over).success, false);
});

test("a refusal says how long a note may be and that a line break counts as one", () => {
  const result = noteContent.safeParse("x".repeat(MAX_NOTE_LENGTH + 1));
  assert.equal(result.success, false);
  assert.match(result.error!.issues[0].message, /100,000 characters/);
  assert.match(result.error!.issues[0].message, /line break counts as one/);
});

test("a note that is not there is an empty note when the action asks for a default", () => {
  assert.equal(noteContent.default("").parse(undefined), "");
  assert.equal(noteContent.default("").parse(""), "");
});

test("hostile text of a million characters is normalised in well under a second", () => {
  const N = 1_000_000;
  const shapes: Record<string, string> = {
    "only CR": "\r".repeat(N),
    "CR LF pairs": "\r\n".repeat(N / 2),
    "LF CR pairs": "\n\r".repeat(N / 2),
    "CR CR LF": "\r\r\n".repeat(N / 3),
    "no line breaks": "a".repeat(N),
    "line breaks at the very end": `${"a".repeat(N - 2)}\r\n`,
  };
  for (const [name, text] of Object.entries(shapes)) {
    const started = performance.now();
    normalizeLineBreaks(text);
    const took = performance.now() - started;
    assert.ok(took < 1000, `${name}: ${took.toFixed(0)} ms`);
  }
});

test("the longest submission that can be valid is accepted quickly", () => {
  // 200,000 characters of CR LF is a valid 100,000-character note.
  const started = performance.now();
  const valid = noteContent.safeParse("\r\n".repeat(MAX_NOTE_LENGTH));
  assert.ok(valid.success);
  assert.equal(valid.data.length, MAX_NOTE_LENGTH);
  assert.ok(performance.now() - started < 1000);
});

test("a submission past twice the limit is refused on its length, without being rewritten", () => {
  // Nothing past twice the limit can shrink to a valid note, so the answer is known
  // before any work. The server-action body limit is 15 MB, and a bare CR is the
  // slowest shape to rewrite (about 0.7 s of the single server process on this machine),
  // so the cost is compared rather than timed against a number that another machine
  // would change: refusing must be at least twenty times cheaper than rewriting.
  const huge = "\r".repeat(15_000_000);
  let started = performance.now();
  normalizeLineBreaks(huge);
  const rewriting = performance.now() - started;

  started = performance.now();
  const refused = noteContent.safeParse(huge);
  const refusing = performance.now() - started;

  assert.equal(refused.success, false);
  assert.ok(
    refusing * 20 < rewriting,
    `refusing took ${refusing.toFixed(2)} ms, rewriting the same text ${rewriting.toFixed(0)} ms`,
  );
});
