// Which lines of a Markdown text sit inside a fenced code block. Pure, so the two
// callers that must agree on it (adding a "See also" link, finding mentions) share
// one rule. CommonMark's: a fence opens with three or more backticks or tildes
// indented at most three spaces, and closes with the same character, at least as
// many of it, and nothing else on the line. Fences inside an indented list item
// are not recognised.

const OPEN = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/;
const CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

export type FenceScan = {
  /** One entry per line; the fence lines themselves count as inside. */
  inFence: boolean[];
  /** The marker of a fence still open after the last line, or null. */
  open: string | null;
};

export function scanFences(lines: string[]): FenceScan {
  const inFence: boolean[] = [];
  let open: string | null = null;

  for (const line of lines) {
    if (open === null) {
      const match = OPEN.exec(line);
      // A backtick fence's info string cannot hold a backtick; ``` `x` ``` is inline code.
      if (match && !(match[1][0] === "`" && match[2].includes("`"))) {
        open = match[1];
        inFence.push(true);
      } else {
        inFence.push(false);
      }
      continue;
    }

    inFence.push(true);
    const close = CLOSE.exec(line);
    if (close && close[1][0] === open[0] && close[1].length >= open.length) {
      open = null;
    }
  }

  return { inFence, open };
}
