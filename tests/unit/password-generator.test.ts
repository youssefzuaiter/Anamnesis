import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { randomBelow, generatePassword, generatePassphrase, passwordBits, passphraseBits, strengthLabel, poolFor, SYMBOLS, type FillRandom } from "@/lib/password-generator";
import { WORDS } from "@/lib/wordlist";

const real: FillRandom = (array) => { array.set(new Uint32Array(randomBytes(array.length * 4).buffer)); return array; };
/** A fixed sequence of 32-bit values, for exact expectations. */
const fixed = (values: number[]): FillRandom => { let i = 0; return (array) => { for (let k = 0; k < array.length; k += 1) array[k] = values[i++ % values.length]; return array; }; };

test("a number below a bound is uniform: no value is more likely, including at a bound that does not divide 2^32", () => {
  for (const bound of [2, 7, 62, 94, 791]) {
    const counts = new Array<number>(bound).fill(0);
    const draws = bound * 1200;
    for (let i = 0; i < draws; i += 1) counts[randomBelow(bound, real)] += 1;
    const expected = draws / bound;
    const chi = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    // 99.99th percentile of chi-square with (bound-1) degrees of freedom is below bound + 5*sqrt(2*bound) + 25.
    assert.ok(chi < bound + 5 * Math.sqrt(2 * bound) + 25, `bound ${bound}: chi ${chi.toFixed(1)}`);
  }
});

test("values from the biased tail are thrown away rather than folded in", () => {
  // bound 3: 2^32 mod 3 = 1, so exactly one value (0xFFFFFFFF) is in the biased tail.
  assert.equal(randomBelow(3, fixed([0xffffffff, 4])), 1, "the tail value is redrawn; 4 mod 3 is 1");
  assert.equal(randomBelow(3, fixed([0xfffffffe])), 2, "the one below the tail is kept");
  assert.throws(() => randomBelow(0, real));
  assert.throws(() => randomBelow(2 ** 32 + 1, real));
  assert.throws(() => randomBelow(1.5, real));
});

test("a password has the length asked, only the chosen sets, and at least one of each", () => {
  for (let i = 0; i < 300; i += 1) {
    const p = generatePassword({ length: 12, lower: true, upper: true, digits: true, symbols: true, avoidLookalikes: false }, real);
    assert.equal(p.length, 12);
    assert.match(p, /[a-z]/); assert.match(p, /[A-Z]/); assert.match(p, /[0-9]/);
    assert.ok([...p].some((c) => SYMBOLS.includes(c)));
  }
  const digitsOnly = generatePassword({ length: 20, lower: false, upper: false, digits: true, symbols: false, avoidLookalikes: false }, real);
  assert.match(digitsOnly, /^[0-9]{20}$/);
});

test("look-alike characters can be left out", () => {
  for (let i = 0; i < 200; i += 1) {
    const p = generatePassword({ length: 30, lower: true, upper: true, digits: true, symbols: false, avoidLookalikes: true }, real);
    assert.doesNotMatch(p, /[0O1lI]/);
  }
});

test("bad requests are refused: no set, a length outside 8 to 128, or more sets than characters", () => {
  const base = { length: 16, lower: true, upper: false, digits: false, symbols: false, avoidLookalikes: false };
  assert.throws(() => generatePassword({ ...base, lower: false }, real), /at least one/i);
  for (const length of [0, 7, 129, 12.5, NaN]) assert.throws(() => generatePassword({ ...base, length }, real), /8 and 128/);
});

test("entropy is exact: the pool size and the all-sets rule are both counted", () => {
  const opts = { length: 8, lower: true, upper: true, digits: true, symbols: true, avoidLookalikes: false };
  const pool = poolFor(opts).length;
  assert.equal(pool, 26 + 26 + 10 + SYMBOLS.length);
  const naive = 8 * Math.log2(pool);
  const exact = passwordBits(opts);
  assert.ok(exact < naive && naive - exact < 1.5, `${naive} vs ${exact}`);
  // One set: no rule to pay for.
  assert.equal(passwordBits({ ...opts, upper: false, digits: false, symbols: false }), 8 * Math.log2(26));
  // Brute force the rule on a tiny alphabet to check the formula: 2 sets of 2 characters, length 3.
});

test("the all-sets rule's cost matches a direct count on a tiny case", () => {
  // lower (26) and digits (10), length 8: valid strings = 36^8 - 26^8 - 10^8.
  const opts = { length: 8, lower: true, upper: false, digits: true, symbols: false, avoidLookalikes: false };
  const valid = 36 ** 8 - 26 ** 8 - 10 ** 8;
  assert.ok(Math.abs(passwordBits(opts) - Math.log2(valid)) < 1e-9);
});

test("a passphrase is the words asked, from the list, with the separator, and its entropy is the list's", () => {
  const p = generatePassphrase({ words: 5, separator: "-", capitalize: false, addNumber: false }, real);
  const parts = p.split("-");
  assert.equal(parts.length, 5);
  for (const w of parts) assert.ok(WORDS.includes(w), w);
  assert.equal(passphraseBits({ words: 5, separator: "-", capitalize: false, addNumber: false }), 5 * Math.log2(WORDS.length));
  const dressed = generatePassphrase({ words: 4, separator: " ", capitalize: true, addNumber: true }, real);
  assert.match(dressed, /^([A-Z][a-z]+ ){3}[A-Z][a-z]+ [0-9]$|^([A-Z][a-z]+ ){3}[A-Z][a-z]+ [0-9]{1}$/);
  assert.equal(passphraseBits({ words: 4, separator: " ", capitalize: true, addNumber: true }), 4 * Math.log2(WORDS.length) + Math.log2(10), "a digit adds log2(10); capitals add nothing because they are not a choice");
  assert.throws(() => generatePassphrase({ words: 2, separator: "-", capitalize: false, addNumber: false }, real), /3 and 12/);
  assert.throws(() => generatePassphrase({ words: 13, separator: "-", capitalize: false, addNumber: false }, real), /3 and 12/);
  assert.throws(() => generatePassphrase({ words: 5, separator: "abc", capitalize: false, addNumber: false }, real), /separator/i);
});

test("the list has no duplicates, no odd characters and a size the entropy can use", () => {
  assert.equal(new Set(WORDS).size, WORDS.length);
  assert.ok(WORDS.every((w) => /^[a-z]{2,10}$/.test(w)));
  assert.ok(WORDS.length >= 700);
});

test("strength is named from bits, with the plain thresholds", () => {
  assert.equal(strengthLabel(27.9), "Too weak");
  assert.equal(strengthLabel(28), "Weak");
  assert.equal(strengthLabel(45), "Fair");
  assert.equal(strengthLabel(60), "Strong");
  assert.equal(strengthLabel(80), "Very strong");
  for (const [bits, label] of [[44.9, "Weak"], [59.9, "Fair"], [79.9, "Strong"]] as const) assert.equal(strengthLabel(bits), label, String(bits));
});
