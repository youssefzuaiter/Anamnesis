// A password and passphrase generator (ROADMAP item 59). Pure: the source of randomness is passed in (the page gives it `crypto.getRandomValues`), so the
// rules are testable and nothing here touches a server, a store or the network.

import { WORDS } from "@/lib/wordlist";

/** Fills an array with random 32-bit values: `crypto.getRandomValues` in the browser. */
export type FillRandom = (array: Uint32Array) => Uint32Array;

export const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const LOOKALIKES = new Set("0O1lI|".split(""));

/** A uniform integer in [0, bound), by rejection: a draw from the uneven tail of 2^32 is thrown away, never folded in with a modulus. */
export function randomBelow(bound: number, fill: FillRandom): number {
  if (!Number.isInteger(bound) || bound < 1 || bound > 2 ** 32) throw new Error("The bound must be a whole number from 1 to 2^32.");
  const limit = 2 ** 32 - (2 ** 32 % bound);
  const slot = new Uint32Array(1);
  for (;;) {
    const value = fill(slot)[0];
    if (value < limit) return value % bound;
  }
}

export type PasswordOptions = { length: number; lower: boolean; upper: boolean; digits: boolean; symbols: boolean; avoidLookalikes: boolean };

const setsOf = (o: PasswordOptions): string[] =>
  [o.lower ? LOWER : "", o.upper ? UPPER : "", o.digits ? DIGITS : "", o.symbols ? SYMBOLS : ""]
    .map((set) => (o.avoidLookalikes ? [...set].filter((c) => !LOOKALIKES.has(c)).join("") : set))
    .filter((set) => set.length > 0);

export const poolFor = (o: PasswordOptions): string => setsOf(o).join("");

function check(o: PasswordOptions): string[] {
  if (!Number.isInteger(o.length) || o.length < 8 || o.length > 128) throw new Error("The length must be a whole number between 8 and 128.");
  const sets = setsOf(o);
  if (sets.length === 0) throw new Error("Choose at least one kind of character.");
  return sets;
}

/**
 * A random password. Every chosen set appears at least once: whole strings are drawn uniformly and a string missing a set is drawn again, so the result is
 * uniform over the strings that satisfy the rule (no set is "pre-placed", which would make positions guessable).
 */
export function generatePassword(o: PasswordOptions, fill: FillRandom): string {
  const sets = check(o);
  const pool = sets.join("");
  for (;;) {
    let out = "";
    for (let i = 0; i < o.length; i += 1) out += pool[randomBelow(pool.length, fill)];
    if (sets.every((set) => [...out].some((c) => set.includes(c)))) return out;
  }
}

/** Bits of entropy: log2 of how many strings satisfy the rule, by inclusion–exclusion over the sets that are missing (exact, not the pool-size estimate). */
export function passwordBits(o: PasswordOptions): number {
  const sets = check(o);
  const total = sets.join("").length;
  let valid = 0;
  for (let mask = 0; mask < 1 << sets.length; mask += 1) {
    let size = total;
    let bits = 0;
    for (let k = 0; k < sets.length; k += 1) if (mask & (1 << k)) { size -= sets[k].length; bits += 1; }
    valid += (bits % 2 === 0 ? 1 : -1) * size ** o.length;
  }
  return Math.log2(valid);
}

export type PassphraseOptions = { words: number; separator: string; capitalize: boolean; addNumber: boolean };

function checkPhrase(o: PassphraseOptions): void {
  if (!Number.isInteger(o.words) || o.words < 3 || o.words > 12) throw new Error("The number of words must be between 3 and 12.");
  if (o.separator.length > 1 || /[a-zA-Z0-9]/.test(o.separator)) throw new Error("The separator must be empty or one punctuation mark or space.");
}

export function generatePassphrase(o: PassphraseOptions, fill: FillRandom): string {
  checkPhrase(o);
  const words = Array.from({ length: o.words }, () => {
    const word = WORDS[randomBelow(WORDS.length, fill)];
    return o.capitalize ? word[0].toUpperCase() + word.slice(1) : word;
  });
  if (o.addNumber) words.push(String(randomBelow(10, fill)));
  return words.join(o.separator);
}

/** The words are independent draws from the list; a capital on each is a fixed rule, not a choice, so it adds nothing. A digit adds log2(10). */
export function passphraseBits(o: PassphraseOptions): number {
  checkPhrase(o);
  return o.words * Math.log2(WORDS.length) + (o.addNumber ? Math.log2(10) : 0);
}

/** A plain name for a number of bits (an offline attacker's guesses, not an online login). */
export function strengthLabel(bits: number): "Too weak" | "Weak" | "Fair" | "Strong" | "Very strong" {
  if (bits < 28) return "Too weak";
  if (bits < 45) return "Weak";
  if (bits < 60) return "Fair";
  if (bits < 80) return "Strong";
  return "Very strong";
}
