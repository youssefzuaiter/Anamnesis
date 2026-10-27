import type { Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";

/**
 * How a note's Markdown becomes HTML: tables and task lists (GFM), then maths.
 * `$...$` is inline maths, `$$...$$` is a block, and `\$` is a literal dollar
 * sign. Two bare dollar amounts on one line ("$5 and $10") are read as maths;
 * that is the usual trade-off of this syntax, pinned by a test.
 */
export const remarkPlugins: NonNullable<Options["remarkPlugins"]> = [
  remarkGfm,
  remarkMath,
];

/**
 * KaTeX is listed first so the highlighter never meets the `language-math` code
 * that maths is parsed into; it would otherwise record a "not registered"
 * warning for every formula. The output is the same either way (checked by
 * swapping them), so this is about noise, not correctness.
 *
 * - An invalid formula never fails the note: rehype-katex catches the error
 *   itself and shows the text that was typed, in `errorColor`.
 * - `strict: "ignore"` stops KaTeX writing a console warning for input that is
 *   fine here but not strict LaTeX, such as an accented letter in a formula.
 * - `trust` is left at its default, off. Turning it on would let a formula
 *   write links and raw HTML, and a note's text can come from an imported PDF.
 * - `detect: false` leaves a fence with no language plain rather than guessing.
 *   A language the highlighter does not know is left plain too; it never throws.
 */
export const rehypePlugins: NonNullable<Options["rehypePlugins"]> = [
  [rehypeKatex, { errorColor: "var(--warn)", strict: "ignore" }],
  [rehypeHighlight, { detect: false }],
];
