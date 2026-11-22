// Translate a note (ROADMAP item 57): the parts that are not the engine. Pure.
//
// A note is Markdown: maths, code, [[wiki links]], addresses and card blanks must come out exactly as they went in, and a translation engine (a 3B model or
// a service) cannot be trusted with them. So code takes them out before translating, leaves a numbered marker in their place, and puts them back after,
// and a line whose markers did not all come back once is not trusted: it is kept as written, and the result says how many lines were.

export const MAX_TRANSLATE_CHARS = 20_000;
/** A longer single line is kept as written, not sent: it bounds the work and is almost always a pasted block, not prose. */
export const MAX_LINE_CHARS = 2_000;

export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "tr", name: "Turkish" },
  { code: "ar", name: "Arabic" },
  { code: "de", name: "German" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "zh", name: "Chinese" },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]];
export const languageName = (code: LanguageCode): string => LANGUAGES.find((l) => l.code === code)!.name;

export type Segment =
  | { kind: "keep"; text: string }
  | { kind: "text"; prefix: string; body: string; tokens: string[] };

const FENCE = /^\s{0,3}(```|~~~)/;
const BLOCK_MATH = /^\s*\$\$\s*$/;
const PREFIX = /^(?:\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+|>\s*))+/;
const SPAN = new RegExp(
  [
    "`[^`\\n]{1,500}`",
    "\\\\\\$",
    "\\$\\$[^\\n]{1,1000}?\\$\\$",
    "\\$(?![\\s$])[^$\\n]{1,500}?(?<![\\s\\\\])\\$",
    "\\[\\[[^\\]\\n]{1,200}\\]\\]",
    "\\]\\([^)\\s]{1,2000}(?:\\s+\"[^\"\\n]{0,200}\")?\\)",
    "\\{\\{c\\d{1,2}::[^\\n]{0,500}?\\}\\}",
    "https?://[^\\s<>)\\]]{0,2000}[^\\s<>)\\].,;:!?'\"]",
    "[\\w.+-]{1,64}@[\\w-]{1,64}(?:\\.[\\w-]{1,64}){1,6}",
  ].join("|"),
  "g",
);

export const marker = (index: number): string => `⟦${index}⟧`;

/** Splits a note into lines to send and lines to keep: fenced code, `$$` blocks, tables, blank lines and over-long lines are kept as written. */
export function segment(note: string): Segment[] {
  const out: Segment[] = [];
  let fence: string | null = null;
  let math = false;
  for (const line of note.replace(/\r\n?/g, "\n").split("\n")) {
    const f = FENCE.exec(line);
    if (fence !== null) {
      out.push({ kind: "keep", text: line });
      if (f && f[1] === fence) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      out.push({ kind: "keep", text: line });
      continue;
    }
    if (BLOCK_MATH.test(line)) {
      math = !math;
      out.push({ kind: "keep", text: line });
      continue;
    }
    if (math || line.trim() === "" || /^\s*\|/.test(line) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line) || line.length > MAX_LINE_CHARS) {
      out.push({ kind: "keep", text: line });
      continue;
    }
    const prefix = PREFIX.exec(line)?.[0] ?? "";
    const rest = line.slice(prefix.length);
    const tokens: string[] = [];
    const body = rest.replace(SPAN, (match) => {
      tokens.push(match);
      return marker(tokens.length - 1);
    });
    // Nothing left to translate (the line was only protected parts): kept.
    out.push(/[\p{L}]/u.test(body.replace(/⟦\d+⟧/g, "")) ? { kind: "text", prefix, body, tokens } : { kind: "keep", text: line });
  }
  return out;
}

/** Puts the protected parts back. Null when a marker is missing, repeated or invented: that line cannot be trusted. */
export function restore(translated: string, tokens: string[]): string | null {
  const found = translated.match(/⟦\d+⟧/g) ?? [];
  if (found.length !== tokens.length) return null;
  const seen = new Set<number>();
  for (const m of found) {
    const index = Number(m.slice(1, -1));
    if (!Number.isInteger(index) || index < 0 || index >= tokens.length || seen.has(index)) return null;
    seen.add(index);
  }
  return translated.replace(/⟦(\d+)⟧/g, (_m, i: string) => tokens[Number(i)]);
}

export type Assembled = { text: string; translated: number; kept: number };

/**
 * Builds the note from the segments and the engine's answer for each `text` segment, in order (null: the engine gave nothing for it). A line whose
 * answer fails `restore`, is empty, or is not a single line is kept as written, and counted.
 */
export function assemble(segments: Segment[], answers: (string | null)[]): Assembled {
  let n = 0;
  let translated = 0;
  let kept = 0;
  const lines = segments.map((segment) => {
    if (segment.kind === "keep") return segment.text;
    const answer = answers[n++];
    const original = segment.prefix + restore(segment.body, segment.tokens)!;
    if (answer === null || answer === undefined || answer.trim() === "" || /\n/.test(answer.trim())) {
      kept += 1;
      return original;
    }
    const back = restore(answer.trim(), segment.tokens);
    if (back === null) {
      kept += 1;
      return original;
    }
    translated += 1;
    return segment.prefix + back;
  });
  return { text: lines.join("\n"), translated, kept };
}

/** The new note: titled with the language, opening with a link back to the original and a plain warning that it is machine translated. */
export function translationNote(title: string, language: LanguageCode, text: string, stats: { translated: number; kept: number }, now: Date): { title: string; content: string } {
  const name = languageName(language);
  const plain = /[[\]]/.test(title) || title.includes("\n") ? `“${title.replace(/[[\]\n]/g, " ").replace(/\s+/g, " ").trim()}”` : `[[${title}]]`;
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const left = stats.kept > 0 ? ` ${stats.kept} ${stats.kept === 1 ? "line" : "lines"} could not be translated safely and ${stats.kept === 1 ? "is" : "are"} kept as written.` : "";
  return {
    title: `${title} (${name})`.slice(0, 200),
    content: `> Machine translation of ${plain} into ${name}, made on ${day}. Check it against the original before relying on it.${left}\n\n${text}`,
  };
}
