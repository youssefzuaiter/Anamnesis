// APA 7 citations and reference lists, written here rather than with citeproc (whose CPAL/AGPL licence
// the owner declined). Pure. What it follows, and what it leaves out, is listed in CLAUDE.md
// ("References and citations"); the tests pin each rule with APA's own examples.

import type { RefFields, RefName } from "@/lib/bibtex";
import type { CiteItem } from "@/lib/citations";

export type ApaPart = { text: string; italic: boolean };
export type ApaContext = { order: RefFields[]; byKey: Map<string, RefFields>; yearLabel: Map<string, string> };

const people = (names: RefName[]) => names.filter((name) => !("literal" in name && name.literal === "others"));
const hasOthers = (names: RefName[]) => names.some((name) => "literal" in name && name.literal === "others");
const familyOf = (name: RefName) => ("literal" in name ? name.literal : name.family);

/** "Jane-Marie Anne" as "J.-M. A."; an initial already given keeps its one dot. */
function initials(given: string): string {
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split("-")
        .filter(Boolean)
        .map((part) => `${[...part][0].toUpperCase()}.`)
        .join("-"),
    )
    .join(" ");
}

const listName = (name: RefName) => ("literal" in name ? name.literal : name.given ? `${name.family}, ${initials(name.given)}` : name.family);
const editorName = (name: RefName) => ("literal" in name ? name.literal : name.given ? `${initials(name.given)} ${name.family}` : name.family);

function sortName(name: RefName): string {
  return "literal" in name ? name.literal.toLowerCase() : `${name.family} ${name.given ?? ""}`.toLowerCase();
}

/** APA's order: authors name by name (one author before the same author with others), year, title. */
function compare(a: RefFields, b: RefFields): number {
  const an = people(a.authors);
  const bn = people(b.authors);
  const lead = (ref: RefFields, names: RefName[]) => (names.length ? sortName(names[0]) : ref.title.toLowerCase());
  const first = lead(a, an).localeCompare(lead(b, bn), "en");
  if (first !== 0) return first;
  for (let i = 1; i < Math.max(an.length, bn.length); i++) {
    if (i >= an.length) return -1;
    if (i >= bn.length) return 1;
    const next = sortName(an[i]).localeCompare(sortName(bn[i]), "en");
    if (next !== 0) return next;
  }
  if (a.year !== b.year) return (a.year ?? -1) - (b.year ?? -1); // n.d. first
  return a.title.localeCompare(b.title, "en");
}

/** Sorts the works and gives two works by the same authors in the same year the letters a, b, … by title. */
export function apaContext(refs: RefFields[]): ApaContext {
  const order = [...refs].sort(compare);
  const byKey = new Map(refs.map((ref) => [ref.key, ref]));
  const groups = new Map<string, RefFields[]>();
  for (const ref of order) {
    const id = `${people(ref.authors).map(sortName).join("|") || ref.title.toLowerCase()}#${ref.year ?? "nd"}`;
    groups.set(id, [...(groups.get(id) ?? []), ref]);
  }
  const yearLabel = new Map<string, string>();
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.title.localeCompare(b.title, "en"));
    sorted.forEach((ref, index) => {
      const base = ref.year === null ? "n.d." : String(ref.year);
      const letter = sorted.length > 1 ? String.fromCharCode(97 + (index % 26)) : "";
      yearLabel.set(ref.key, ref.year === null && letter ? `${base}-${letter}` : `${base}${letter}`);
    });
  }
  return { order, byKey, yearLabel };
}

/** The author part of an in-text citation: one, two (with & or "and"), or the first et al. */
function citeNames(ref: RefFields, narrative: boolean): string {
  const names = people(ref.authors);
  if (names.length === 0) return `"${ref.title}"`;
  if (names.length === 1 && !hasOthers(ref.authors)) return familyOf(names[0]);
  if (names.length === 2 && !hasOthers(ref.authors)) return `${familyOf(names[0])} ${narrative ? "and" : "&"} ${familyOf(names[1])}`;
  return `${familyOf(names[0])} et al.`;
}

/** "(Smith, 2019, p. 3; see Vaswani et al., 2017)", or "Smith and Doe (2018)" when narrative. */
export function inTextApa(ctx: ApaContext, items: CiteItem[], narrative: boolean): string {
  const position = (key: string) => {
    const ref = ctx.byKey.get(key);
    return ref ? ctx.order.indexOf(ref) : Number.MAX_SAFE_INTEGER;
  };
  const sorted = [...items].sort((a, b) => position(a.key) - position(b.key));
  if (narrative && sorted.length === 1) {
    const [item] = sorted;
    const ref = ctx.byKey.get(item.key);
    if (!ref) return `@${item.key}?`;
    const year = ctx.yearLabel.get(ref.key)!;
    return `${citeNames(ref, true)} (${year}${item.locator ? `, ${item.locator}` : ""})`;
  }
  const parts = sorted.map((item) => {
    const ref = ctx.byKey.get(item.key);
    const body = !ref
      ? `${item.key}?`
      : `${item.suppressAuthor ? "" : `${citeNames(ref, false)}, `}${ctx.yearLabel.get(ref.key)}${item.locator ? `, ${item.locator}` : ""}`;
    return `${item.prefix ? `${item.prefix} ` : ""}${body}`;
  });
  return `(${parts.join("; ")})`;
}

/** Ends a sentence-like piece with a full stop unless it already ends with one, ? or !. */
const stop = (text: string) => (/[.?!]$/.test(text) ? text : `${text}.`);

function authorList(names: RefName[]): string {
  const list = people(names).map(listName);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length <= 20) return `${list.slice(0, -1).join(", ")}, & ${list[list.length - 1]}`;
  return `${list.slice(0, 19).join(", ")}, . . . ${list[list.length - 1]}`;
}

function editorList(names: RefName[]): string {
  const list = people(names).map(editorName);
  const joined = list.length <= 2 ? list.join(" & ") : `${list.slice(0, -1).join(", ")}, & ${list[list.length - 1]}`;
  return `${joined} (${list.length === 1 ? "Ed." : "Eds."})`;
}

function ordinal(edition: string): string | null {
  const n = Number(edition);
  if (!Number.isInteger(n)) return /^(1st|first)$/i.test(edition) ? null : `${edition} ed.`;
  if (n <= 1) return null;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix} ed.`;
}

/** One reference-list entry, in parts so the caller can italicise what APA italicises. */
export function referenceApa(ctx: ApaContext, ref: RefFields): ApaPart[] {
  const parts: ApaPart[] = [];
  const add = (text: string, italic = false) => {
    if (text) parts.push({ text, italic });
  };
  const year = ctx.yearLabel.get(ref.key) ?? (ref.year === null ? "n.d." : String(ref.year));
  const authors = authorList(ref.authors);
  const standalone = ref.type === "book" || ref.type === "thesis" || ref.type === "report" || ref.type === "web" || ref.type === "other";

  // Author, then date. A work with no author starts with its title instead.
  if (authors) add(`${stop(authors)} (${year}). `);
  else {
    add(stop(ref.title), standalone);
    add(` (${year}). `);
  }

  const titleDone = !authors;
  switch (ref.type) {
    case "article": {
      if (!titleDone) add(`${stop(ref.title)} `);
      if (ref.container) {
        add(ref.volume ? `${ref.container}, ${ref.volume}` : ref.container, true);
        let rest = ref.issue ? `(${ref.issue})` : "";
        if (ref.pages) rest += `, ${ref.pages}`;
        add(`${rest}.`);
      }
      break;
    }
    case "chapter":
    case "paper": {
      if (!titleDone) add(`${stop(ref.title)} `);
      if (ref.container) {
        add(`In ${ref.editors?.length ? `${editorList(ref.editors)}, ` : ""}`);
        add(ref.container, true);
        add(`${ref.pages ? ` (pp. ${ref.pages})` : ""}.`);
      }
      if (ref.publisher) add(` ${stop(ref.publisher)}`);
      break;
    }
    case "thesis": {
      const kind = ref.degree === "doctoral" ? "Doctoral dissertation" : ref.degree === "masters" ? "Master's thesis" : "Thesis";
      if (!titleDone) add(ref.title, true);
      add(`${titleDone ? "" : " "}[${kind}${ref.institution ? `, ${ref.institution}` : ""}].`);
      break;
    }
    case "report": {
      if (!titleDone) add(ref.title, true);
      add(`${ref.number ? ` (Report No. ${ref.number})` : ""}.`);
      const by = ref.institution ?? ref.publisher;
      if (by) add(` ${stop(by)}`);
      break;
    }
    default: {
      // book, web, other
      if (!titleDone) add(ref.title, true);
      const edition = ref.edition ? ordinal(ref.edition) : null;
      if (!titleDone) add(`${edition ? ` (${edition})` : ""}.`);
      else if (edition) add(`(${edition}). `);
      const by = ref.type === "web" ? ref.container : (ref.publisher ?? ref.container);
      if (by) add(`${titleDone ? "" : " "}${stop(by)}`);
    }
  }

  const link = ref.doi ? `https://doi.org/${ref.doi}` : ref.url;
  if (link) add(` ${link}`);

  // Tidy the joins: one space between pieces, none before a full stop.
  const text = parts.map((p) => p.text).join("");
  if (/\s$/.test(text) && parts.length) parts[parts.length - 1] = { ...parts.at(-1)!, text: parts.at(-1)!.text.trimEnd() };
  return parts;
}

/** The works in reference-list order. */
export function referenceListApa(ctx: ApaContext): RefFields[] {
  return ctx.order;
}
