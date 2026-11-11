// Sharing a page into Anamnesis from a phone or another app. Pure: no network, no database.
//
// What arrives is whatever the sharing app chose to send: Android usually puts the address inside a
// `text` like "Great read https://… via @someone", iOS Shortcuts send `url`. The link found here only
// prefills the clip card; nothing is fetched until the person taps Clip page.

const MAX_LINK = 2_000;
/** How far past the scheme a link is read. A match that reaches it may go on, so it is refused. */
const SCAN = MAX_LINK + 100;
const MAX_NEXT = 2_500;
const BASE = "https://anamnesis.invalid";

/** An http(s) URL of at most MAX_LINK characters, or null. */
function httpUrl(raw: string): string | null {
  if (raw.length > MAX_LINK) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

/** Drops sentence punctuation after a link, and a closing bracket the link did not open. */
function trimTrailing(link: string): string {
  let end = link.length;
  for (;;) {
    const last = link[end - 1];
    const kept = link.slice(0, end);
    if (".,;:!?'\"’”".includes(last)) end--;
    else if (last === ")" && kept.split("(").length < kept.split(")").length) end--;
    else if (last === "]" && kept.split("[").length < kept.split("]").length) end--;
    else return kept;
  }
}

/** The link a share carries: `url` when it is one, else the first http(s) address in `text`. */
export function sharedLink(params: { url?: unknown; text?: unknown }): string | null {
  if (typeof params.url === "string") {
    const direct = httpUrl(params.url.trim());
    if (direct) return direct;
  }
  if (typeof params.text !== "string") return null;
  // Bounded, so a long text without a link, or one enormous "link", is one linear pass.
  const match = new RegExp(`(https?://)([^\\s<>"\`]{1,${SCAN}})`, "i").exec(params.text);
  if (!match || match[2].length >= SCAN) return null;
  return httpUrl(trimTrailing(match[0]));
}

/** The clip card, prefilled with `link` when there is one. */
export function shareTarget(link: string | null): string {
  return link ? `/notes/import?url=${encodeURIComponent(link)}` : "/notes/import";
}

/**
 * Where to go after signing in, accepted only as a path on this site: one leading slash, no second
 * slash or backslash after it (browsers read `//host` and `/\host` as another site), no backslash or
 * control character anywhere, and it must still resolve to this host. Anything else is null.
 */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_NEXT) return null;
  if (raw[0] !== "/" || raw[1] === "/" || raw.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    return new URL(raw, BASE).origin === BASE ? raw : null;
  } catch {
    return null;
  }
}
