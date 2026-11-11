// BibTeX in and out. Pure: no network, no database.
//
// Written here rather than taken from a package: the maintained parsers are megabytes with heavy
// dependencies or are years old without LaTeX decoding, which Turkish names need ({\u{g}}, {\i},
// {\c{s}}). It reads what Google Scholar, Zotero, Mendeley, IEEE Xplore and arXiv export: entries,
// @string macros, # concatenation, month macros, nested braces, quoted values. It is one linear pass
// over the text: a value may not run past a line that starts a new entry, so a broken entry is
// reported and the next one is still read, and nothing is scanned twice.

export type RefName = { family: string; given?: string } | { literal: string };

export const REFERENCE_TYPES = ["article", "book", "chapter", "paper", "thesis", "report", "web", "other"] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export type RefFields = {
  key: string;
  type: ReferenceType;
  title: string;
  authors: RefName[];
  year: number | null;
  container?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  edition?: string;
  editors?: RefName[];
  institution?: string;
  number?: string;
  doi?: string;
  url?: string;
};

export type ParsedEntry = RefFields & { bibtex: string; line: number };
export type Problem = { line: number; message: string };

export const KEY_PATTERN = /^[A-Za-z0-9_](?:[A-Za-z0-9_:.#$%&+?<>~/-]*[A-Za-z0-9_])?$/;
export const MAX_KEY = 100;
export const MAX_FIELD = 1_000;
export const MAX_NAMES = 100;
export const MAX_ENTRY = 20_000;
const MAX_PROBLEMS = 100;

// ---------------------------------------------------------------------------------------------
// LaTeX to text

const COMBINING: Record<string, string> = {
  "'": "́", "`": "̀", "^": "̂", '"': "̈", "~": "̃", "=": "̄", ".": "̇",
  u: "̆", v: "̌", H: "̋", c: "̧", k: "̨", r: "̊", d: "̣", b: "̱",
};
const LETTERS: Record<string, string> = {
  i: "ı", j: "ȷ", o: "ø", O: "Ø", ss: "ß", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", l: "ł", L: "Ł",
};
const ESCAPES = new Set(["%", "$", "&", "_", "#", "{", "}"]);

/** The balanced group starting at `text[start] === "{"`: its content and the index after it. */
function group(text: string, start: number): { content: string; end: number } {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return { content: text.slice(start + 1, i), end: i + 1 };
  }
  return { content: text.slice(start + 1), end: text.length };
}

function decodeRaw(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      let name: string;
      let next: number;
      if (/[A-Za-z]/.test(text[i + 1] ?? "")) {
        next = i + 1;
        while (next < text.length && /[A-Za-z]/.test(text[next])) next++;
        name = text.slice(i + 1, next);
      } else {
        name = text[i + 1] ?? "";
        next = i + 2;
      }
      const isWord = /^[A-Za-z]+$/.test(name);
      if (ESCAPES.has(name)) {
        out += name;
        i = next;
      } else if (name in COMBINING && (!isWord || name.length === 1)) {
        // The accented letter: {o}, {\i}, o, or (after a letter accent) a space then o.
        let j = next;
        if (isWord) while (text[j] === " ") j++;
        let base: string;
        if (text[j] === "{") {
          const g = group(text, j);
          base = decodeRaw(g.content);
          j = g.end;
        } else if (text[j] === "\\") {
          let k = j + 1;
          while (k < text.length && /[A-Za-z]/.test(text[k])) k++;
          base = LETTERS[text.slice(j + 1, k)] ?? "";
          j = k;
        } else {
          base = text[j] ?? "";
          j++;
        }
        out += base ? base[0] + COMBINING[name] + base.slice(1) : "";
        i = j;
      } else if (name in LETTERS) {
        out += LETTERS[name];
        i = next;
        if (text.startsWith("{}", i)) i += 2;
        else if (text[i] === " ") i++;
      } else {
        // \emph, \textit, \url, \bf and anything unknown: the command goes, its argument stays.
        i = next;
        if (isWord && text[i] === " ") i++;
      }
    } else if (ch === "{" || ch === "}") {
      i++;
    } else if (ch === "~") {
      out += " ";
      i++;
    } else if (ch === "-") {
      let run = 0;
      while (text[i + run] === "-") run++;
      out += run === 2 ? "–" : run === 3 ? "—" : "-".repeat(run);
      i += run;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** BibTeX/LaTeX text as plain Unicode: accents composed, commands and braces removed, spaces collapsed. */
export function decodeLatex(text: string): string {
  return decodeRaw(text).normalize("NFC").replace(/\s+/g, " ").trim();
}

/** A URL or DOI: only the braces, a \url{} wrapper and escaped characters are undone. */
function decodeUrl(text: string): string {
  return text
    .replace(/\\url\s*/g, "")
    .replace(/\\([%&_#$])/g, "$1")
    .replace(/[{}]/g, "")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Names

/** `text` split on `separator` (a regex matching at one position) wherever no brace is open. */
function splitTopLevel(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      separator.lastIndex = i;
      const match = separator.exec(text);
      if (match && match.index === i) {
        parts.push(text.slice(start, i));
        start = i + match[0].length;
        i = start - 1;
      }
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function oneName(raw: string): RefName | null {
  const name = raw.trim();
  if (!name) return null;
  if (name === "others") return { literal: "others" };
  if (name.startsWith("{") && group(name, 0).end === name.length) return { literal: decodeLatex(name) };
  const parts = splitTopLevel(name, /,/y).map((part) => part.trim());
  if (parts.length >= 2) {
    const given = decodeLatex(parts[parts.length - 1]);
    const family = parts.slice(0, -1).map(decodeLatex).join(", ");
    return given ? { family, given } : { family };
  }
  const words = splitTopLevel(name, /\s+/y).filter(Boolean);
  if (words.length === 1) return { family: decodeLatex(words[0]) };
  // "Ludwig van Beethoven": the last word and the lower-case words before it are the family name.
  let first = words.length - 1;
  while (first > 1 && /^[a-z]/.test(decodeLatex(words[first - 1]))) first--;
  return { family: decodeLatex(words.slice(first).join(" ")), given: decodeLatex(words.slice(0, first).join(" ")) };
}

/** The names of an author or editor field, split on "and" outside braces. */
export function parseNames(text: string): RefName[] {
  return splitTopLevel(text, /\s+and\s+/iy).map(oneName).filter((name): name is RefName => name !== null);
}

function writeName(name: RefName): string {
  if ("literal" in name) return name.literal === "others" ? "others" : `{${escapeValue(name.literal)}}`;
  return name.given ? `${escapeValue(name.family)}, ${escapeValue(name.given)}` : escapeValue(name.family);
}

// ---------------------------------------------------------------------------------------------
// Reading

const MONTHS: Record<string, string> = {
  jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June",
  jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December",
};

const TYPE_MAP: Record<string, ReferenceType> = {
  article: "article", book: "book", booklet: "book", inbook: "chapter", incollection: "chapter",
  inproceedings: "paper", conference: "paper", phdthesis: "thesis", mastersthesis: "thesis", thesis: "thesis",
  techreport: "report", report: "report", online: "web", electronic: "web", www: "web",
};

class Unterminated extends Error {
  constructor(readonly at: number) {
    super("unterminated");
  }
}

/** Builds a reader over one text: the shared cursor, line numbers and the start-of-entry rule. */
function reader(text: string) {
  const newlines: number[] = [];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) newlines.push(i);
  const lineAt = (pos: number) => {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlines[mid] < pos) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  /** True when a new entry starts on the line after the newline at `pos`. */
  const entryStartsAfter = (pos: number) => /^[ \t]*@[A-Za-z]+[ \t]*[{(]/.test(text.slice(pos + 1, pos + 80));
  return { lineAt, entryStartsAfter };
}

export function parseBibtex(text: string): { entries: ParsedEntry[]; problems: Problem[] } {
  const entries: ParsedEntry[] = [];
  const problems: Problem[] = [];
  const macros = new Map<string, string>(Object.entries(MONTHS));
  const seen = new Set<string>();
  const { lineAt, entryStartsAfter } = reader(text);
  const problem = (pos: number, message: string) => {
    if (problems.length < MAX_PROBLEMS) problems.push({ line: lineAt(pos), message });
  };

  let pos = 0;
  const skipSpace = () => {
    while (pos < text.length && /\s/.test(text[pos])) pos++;
  };

  /** A braced or quoted value, read up to its close; stops at a line that starts a new entry. */
  const readDelimited = (close: "}" | '"'): string => {
    const start = pos;
    let depth = 0;
    for (; pos < text.length; pos++) {
      const ch = text[pos];
      if (ch === "\\") {
        pos++;
      } else if (ch === "\n" && entryStartsAfter(pos)) {
        throw new Unterminated(pos + 1);
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        if (depth === 0 && close === "}") return text.slice(start, pos++);
        depth--;
        if (depth < 0) throw new Unterminated(pos);
      } else if (ch === '"' && close === '"' && depth === 0) {
        return text.slice(start, pos++);
      }
    }
    throw new Unterminated(text.length);
  };

  /** A value: pieces joined by #, each a braced or quoted string, a number or a macro name. */
  const readValue = (): string => {
    let value = "";
    for (;;) {
      skipSpace();
      const ch = text[pos];
      if (ch === "{") {
        pos++;
        value += readDelimited("}");
      } else if (ch === '"') {
        pos++;
        value += readDelimited('"');
      } else {
        const match = /^[A-Za-z0-9_:.+\-/]+/.exec(text.slice(pos, pos + 200));
        if (!match) throw new Unterminated(pos);
        pos += match[0].length;
        value += /^\d+$/.test(match[0]) ? match[0] : (macros.get(match[0].toLowerCase()) ?? match[0]);
      }
      skipSpace();
      if (text[pos] !== "#") return value;
      pos++;
    }
  };

  /** Skips a balanced @comment or @preamble body. */
  const skipBody = (open: string) => {
    pos++;
    readDelimited(open === "(" ? '"' : "}");
  };

  while (pos < text.length) {
    const at = text.indexOf("@", pos);
    if (at === -1) break;
    pos = at + 1;
    const typeMatch = /^([A-Za-z]+)\s*([{(])/.exec(text.slice(pos, pos + 60));
    if (!typeMatch) continue; // an @ in free text between entries
    const type = typeMatch[1].toLowerCase();
    pos += typeMatch[0].length - 1;
    const open = text[pos];
    const close = open === "(" ? ")" : "}";

    try {
      if (type === "comment" || type === "preamble") {
        skipBody(open);
        continue;
      }
      pos++;
      if (type === "string") {
        skipSpace();
        const name = /^[A-Za-z][\w-]*/.exec(text.slice(pos, pos + 100))?.[0];
        if (!name) throw new Unterminated(pos);
        pos += name.length;
        skipSpace();
        if (text[pos] !== "=") throw new Unterminated(pos);
        pos++;
        macros.set(name.toLowerCase(), readValue());
        skipSpace();
        if (text[pos] === close) pos++;
        continue;
      }

      skipSpace();
      const keyEnd = text.slice(pos, pos + MAX_KEY + 50).search(/[,\s}]/);
      const key = keyEnd === -1 ? text.slice(pos, pos + MAX_KEY + 50) : text.slice(pos, pos + keyEnd);
      pos += key.length;
      const fields = new Map<string, string>();
      for (;;) {
        skipSpace();
        while (text[pos] === ",") {
          pos++;
          skipSpace();
        }
        if (text[pos] === close) {
          pos++;
          break;
        }
        const field = /^[A-Za-z][\w\-:.]*/.exec(text.slice(pos, pos + 100))?.[0];
        if (!field) throw new Unterminated(pos);
        pos += field.length;
        skipSpace();
        if (text[pos] !== "=") throw new Unterminated(pos);
        pos++;
        fields.set(field.toLowerCase(), readValue());
      }

      const source = text.slice(at, pos);
      const why = entryProblem(key, fields, source, seen);
      if (why) {
        problem(at, why);
        continue;
      }
      seen.add(key);
      entries.push({ ...toFields(key, TYPE_MAP[type] ?? "other", type, fields), bibtex: source, line: lineAt(at) });
    } catch (error) {
      if (!(error instanceof Unterminated)) throw error;
      problem(at, `The entry that starts here is not closed properly (read as far as line ${lineAt(error.at)}).`);
      // Carry on at the entry that starts where reading stopped, else the next one on a line of its own,
      // else stop. Reading never goes back before error.at, so the whole parse stays one pass.
      if (/^[ \t]*@[A-Za-z]+[ \t]*[{(]/.test(text.slice(error.at, error.at + 80))) {
        pos = error.at;
        continue;
      }
      const next = text.slice(error.at).search(/\n[ \t]*@[A-Za-z]+[ \t]*[{(]/);
      if (next === -1) break;
      pos = error.at + next + 1;
    }
  }
  return { entries, problems };
}

function entryProblem(key: string, fields: Map<string, string>, source: string, seen: Set<string>): string | null {
  if (!key) return "An entry has no citation key.";
  if (key.length > MAX_KEY || !KEY_PATTERN.test(key)) return `"${key.slice(0, 40)}" cannot be a citation key.`;
  if (seen.has(key)) return `The key "${key}" appears twice; the first is kept.`;
  if (source.length > MAX_ENTRY) return `The entry "${key}" is longer than ${MAX_ENTRY.toLocaleString("en")} characters.`;
  if (!decodeLatex(fields.get("title") ?? "")) return `The entry "${key}" has no title.`;
  for (const [name, value] of fields) {
    if (name !== "abstract" && name !== "file" && name !== "note" && value.length > MAX_FIELD * 2) {
      return `The ${name} of "${key}" is too long.`;
    }
  }
  const people = (fields.get("author") ?? "").split(/\s+and\s+/i).length + (fields.get("editor") ?? "").split(/\s+and\s+/i).length;
  if (people > MAX_NAMES * 2) return `The entry "${key}" lists too many names.`;
  return null;
}

function toFields(key: string, type: ReferenceType, rawType: string, fields: Map<string, string>): RefFields {
  const text = (name: string) => {
    const value = fields.get(name);
    if (value === undefined) return undefined;
    const decoded = decodeLatex(value).slice(0, MAX_FIELD);
    return decoded || undefined;
  };
  const howpublished = fields.get("howpublished");
  const urlFromHow = howpublished && /\\url/.test(howpublished) ? decodeUrl(howpublished) : undefined;
  const url = fields.has("url") ? decodeUrl(fields.get("url")!) : urlFromHow;
  const doi = fields.has("doi") ? decodeUrl(fields.get("doi")!).replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") : undefined;
  const yearText = fields.get("year") ?? fields.get("date") ?? "";
  const yearMatch = /\d{4}/.exec(yearText);
  const year = yearMatch && +yearMatch[0] >= 1000 && +yearMatch[0] <= 2100 ? +yearMatch[0] : null;
  const article = type === "article";
  const finalType: ReferenceType = rawType === "misc" && url ? "web" : type;

  const ref: RefFields = {
    key,
    type: finalType,
    title: text("title")!.slice(0, MAX_FIELD),
    authors: parseNames(fields.get("author") ?? "").slice(0, MAX_NAMES),
    year,
  };
  const set = <K extends keyof RefFields>(name: K, value: RefFields[K] | undefined) => {
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) ref[name] = value;
  };
  set("container", text("journal") ?? text("journaltitle") ?? text("booktitle") ?? (urlFromHow ? undefined : text("howpublished")));
  set("volume", text("volume"));
  set("issue", text("issue") ?? (article ? text("number") : undefined));
  set("pages", text("pages"));
  set("publisher", text("publisher"));
  set("edition", text("edition"));
  set("editors", parseNames(fields.get("editor") ?? "").slice(0, MAX_NAMES));
  set("institution", text("institution") ?? text("school"));
  set("number", article ? undefined : text("number"));
  set("doi", doi ? doi.slice(0, MAX_FIELD) : undefined);
  set("url", url ? url.slice(0, MAX_FIELD) : undefined);
  return ref;
}

// ---------------------------------------------------------------------------------------------
// Writing

function escapeValue(value: string): string {
  return value.replace(/([{}%&$#_\\])/g, "\\$1");
}

const WRITE_TYPE: Record<ReferenceType, string> = {
  article: "article", book: "book", chapter: "incollection", paper: "inproceedings",
  thesis: "phdthesis", report: "techreport", web: "misc", other: "misc",
};

/** One entry, UTF-8 as it is (biber and modern BibTeX read it), every value in braces. */
export function toBibtex(ref: RefFields): string {
  const lines: [string, string][] = [];
  const add = (name: string, value: string | undefined) => {
    if (value) lines.push([name, value]);
  };
  if (ref.authors.length) add("author", ref.authors.map(writeName).join(" and "));
  if (ref.editors?.length) add("editor", ref.editors.map(writeName).join(" and "));
  add("title", escapeValue(ref.title));
  const containerField =
    ref.type === "article" ? "journal" : ref.type === "chapter" || ref.type === "paper" ? "booktitle" : "howpublished";
  add(containerField, ref.container && escapeValue(ref.container));
  add("volume", ref.volume && escapeValue(ref.volume));
  if (ref.type === "article") add("number", ref.issue && escapeValue(ref.issue));
  else add("issue", ref.issue && escapeValue(ref.issue));
  add("number", ref.number && escapeValue(ref.number));
  add("pages", ref.pages && escapeValue(ref.pages));
  add("edition", ref.edition && escapeValue(ref.edition));
  add("publisher", ref.publisher && escapeValue(ref.publisher));
  add(ref.type === "thesis" ? "school" : "institution", ref.institution && escapeValue(ref.institution));
  add("year", ref.year === null ? undefined : String(ref.year));
  add("doi", ref.doi);
  add("url", ref.url);
  return `@${WRITE_TYPE[ref.type]}{${ref.key},\n${lines.map(([name, value]) => `  ${name} = {${value}}`).join(",\n")}\n}\n`;
}
