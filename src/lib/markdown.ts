import type { Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";

type MdNode = { type: string; value?: string; children?: MdNode[] };

/**
 * The most formulas rendered in one note; later ones stay as the text that was
 * typed. A note may be 100,000 characters, and measured on this machine 16,000
 * formulas took about 5 seconds to render and produced 12 MB of HTML, so a
 * single huge or hostile note (an imported PDF can be full of dollar signs)
 * would freeze the server on every view. A real note has dozens; 1,000 renders
 * in well under a second. The number is a judgement, not a KaTeX limit.
 */
export const MAX_FORMULAS = 1000;

function limitFormulas() {
  return (tree: MdNode) => {
    let seen = 0;
    const walk = (node: MdNode) => {
      node.children?.forEach((child, index, siblings) => {
        if ((child.type === "inlineMath" || child.type === "math") && ++seen > MAX_FORMULAS) {
          const source = child.value ?? "";
          siblings[index] =
            child.type === "inlineMath"
              ? { type: "text", value: `$${source}$` }
              : { type: "code", value: source };
          return;
        }
        walk(child);
      });
    };
    walk(tree);
  };
}

/**
 * How a note's Markdown becomes HTML: tables and task lists (GFM), then maths.
 * `$...$` is inline maths, `$$...$$` is a block, and `\$` is a literal dollar
 * sign. Two bare dollar amounts on one line ("$5 and $10") are read as maths;
 * that is the usual trade-off of this syntax, pinned by a test.
 */
export const remarkPlugins: NonNullable<Options["remarkPlugins"]> = [
  remarkGfm,
  remarkMath,
  limitFormulas,
];

/**
 * KaTeX goes first so the highlighter never meets the `language-math` code that
 * maths is parsed into, and records no "not registered" warning per formula.
 * Output is identical either way (checked by swapping them).
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
