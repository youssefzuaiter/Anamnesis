// The address that opens quick capture (ROADMAP item 45), and what a link may put in its box. Pure: no network, no database. A link such as
// `/capture?text=…` (an iOS Shortcut, a bookmark, another app) only prefills the box: nothing is parsed or saved until the person presses Capture
// and then confirms the proposal, as with anything typed there.

/** What the parser accepts (`/api/ai/parse`): longer text would be refused, so it is cut here and the person sees what is in the box. */
export const MAX_CAPTURE = 1000;

/** The text a capture link carries: one plain string, line breaks and control characters as spaces, trimmed, cut at MAX_CAPTURE; anything else is "". */
export function captureText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Only the first stretch can matter: cutting before the clean-up keeps a huge value to one linear pass over what is kept.
  const head = raw.length > MAX_CAPTURE * 8 ? raw.slice(0, MAX_CAPTURE * 8) : raw;
  const oneLine = head.replace(/[\u0000-\u001f\u007f\u2028\u2029\s]+/g, " ").trim();
  return oneLine.slice(0, MAX_CAPTURE).trim();
}

/** The quick-capture address, with `text` filled in when there is some. The text only ever goes into the query, encoded. */
export function captureTarget(text: string): string {
  const clean = captureText(text);
  return clean ? `/capture?text=${encodeURIComponent(clean)}` : "/capture";
}
