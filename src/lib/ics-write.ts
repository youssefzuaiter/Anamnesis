// An RFC 5545 writer for the small subset a calendar feed needs: a calendar of VEVENTs. Pure, with no
// database or environment dependency, like `lib/ics.ts` (the reader), which the tests use to read
// what this writes. Everything here is given text that came from the person's own data but may hold
// anything (a title pasted from a web page, an imported event), so a value can never add a line.

export type IcsItem = {
  uid: string;
  summary: string;
  location?: string | null;
  /**
   * For `allDay`, the Dates' **local** calendar day is meant and the end is exclusive; otherwise
   * they are instants, written in UTC.
   */
  start: Date;
  end: Date;
  allDay?: boolean;
  stamp: Date;
  /** Free time: the event does not make the person busy. */
  transparent?: boolean;
  category?: string;
};

const MAX_SUMMARY = 200;
const MAX_UID = 255;
const FOLD_AT = 75;

/** At most `max` characters (code points), never splitting a pair; stops early on a very long text. */
function clip(text: string, max: number): string {
  let count = 0;
  let end = 0;
  for (const ch of text) {
    if (count === max) break;
    count += 1;
    end += ch.length;
  }
  return text.slice(0, end);
}

/**
 * A value of TEXT type: backslash, semicolon and comma escaped, every line break (CR LF as one, CR,
 * LF, U+2028, U+2029, U+0085) written as `\n`, a tab as a space, every other control character
 * removed, a lone surrogate replaced. The result can never contain a raw CR or LF. One linear pass.
 */
export function escapeIcsText(text: string): string {
  const out: string[] = [];
  let afterCr = false;
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (ch === "\r") {
      out.push("\\n");
      afterCr = true;
      continue;
    }
    if (ch === "\n") {
      if (!afterCr) out.push("\\n");
      afterCr = false;
      continue;
    }
    afterCr = false;
    if (code === 0x2028 || code === 0x2029 || code === 0x85) out.push("\\n");
    else if (ch === "\\") out.push("\\\\");
    else if (ch === ";") out.push("\\;");
    else if (ch === ",") out.push("\\,");
    else if (ch === "\t") out.push(" ");
    else if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) continue;
    else if (code >= 0xd800 && code <= 0xdfff) out.push("�"); // a pair arrives as one code point, so this is a lone half
    else out.push(ch);
  }
  return out.join("");
}

/**
 * Folds a content line: pieces of at most 75 octets (a continuation starts with one space, which
 * counts), cut only between characters, joined with CR LF. Unfolding (removing CR LF and the one
 * space) gives the line back.
 */
export function foldIcsLine(line: string): string {
  const octets = (code: number) => (code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4);
  const pieces: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const width = octets(ch.codePointAt(0) as number);
    if (size + width > FOLD_AT) {
      pieces.push(current);
      current = " ";
      size = 1;
    }
    current += ch;
    size += width;
  }
  pieces.push(current);
  return pieces.join("\r\n");
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");
const utc = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const localDay = (date: Date) => `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
/** A date a calendar can hold: a real instant, from 1970 to the year 9999. */
const usable = (date: Date) => Number.isFinite(date.getTime()) && date.getFullYear() >= 1970 && date.getFullYear() <= 9999;

/**
 * A calendar of events, ready to serve: CR LF line ends, folded lines, escaped values. An item with
 * an invalid date is left out; an end that is not after its start becomes the start (a timed event) or
 * the next day (an all-day one).
 */
export function buildIcs(items: IcsItem[], calendar: { name: string }): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Anamnesis//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(clip(calendar.name, MAX_SUMMARY))}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const item of items) {
    if (!usable(item.start) || !usable(item.end) || !usable(item.stamp)) continue;
    let end = item.end;
    if (item.allDay) {
      if (localDay(end) <= localDay(item.start)) end = new Date(item.start.getFullYear(), item.start.getMonth(), item.start.getDate() + 1);
    } else if (end.getTime() <= item.start.getTime()) {
      end = item.start;
    }

    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(clip(item.uid, MAX_UID))}`,
      `DTSTAMP:${utc(item.stamp)}`,
      `LAST-MODIFIED:${utc(item.stamp)}`,
      item.allDay ? `DTSTART;VALUE=DATE:${localDay(item.start)}` : `DTSTART:${utc(item.start)}`,
      item.allDay ? `DTEND;VALUE=DATE:${localDay(end)}` : `DTEND:${utc(end)}`,
      `SUMMARY:${escapeIcsText(clip(item.summary, MAX_SUMMARY))}`,
    );
    if (item.location) lines.push(`LOCATION:${escapeIcsText(clip(item.location, MAX_SUMMARY))}`);
    if (item.category) lines.push(`CATEGORIES:${escapeIcsText(clip(item.category, MAX_SUMMARY))}`);
    lines.push(`TRANSP:${item.transparent ? "TRANSPARENT" : "OPAQUE"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map((line) => `${foldIcsLine(line)}\r\n`).join("");
}
