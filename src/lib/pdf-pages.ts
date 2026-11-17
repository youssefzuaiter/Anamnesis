// Pages of an imported PDF (ROADMAP item 41). Pure: no Prisma, no React. The importer (`pdf-parse`) writes "-- N of T --" on its own line after
// each page's text, so an imported paper's note already says where every page ends; this reads those lines back instead of storing anything
// else. A note without a believable sequence of them has no pages, and is chunked exactly as before.
import { chunkText, MIN_CHUNK_CHARS } from "@/lib/chunking";

export type PdfPage = { page: number; text: string };
export type PageChunk = { text: string; page: number | null };

const MARKER = /^-- (\d{1,4}) of (\d{1,4}) --$/;
// "-- 1234 of 1234 --" is 18 characters: a longer line is never a marker, and is not worth a regex.
const MAX_MARKER_LENGTH = 18;

/**
 * The pages of a PDF note, or null when its text has no page markers or they do not make a sequence (numbers that increase, one total, none
 * past it). A marker that was deleted by hand leaves the others usable. Text after the last marker is the next page, or the last one if the
 * total is reached; that is what a document cut at the length limit looks like.
 */
export function splitPdfPages(text: string): PdfPage[] | null {
  const lines = text.split("\n");
  const markers: { line: number; page: number; total: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > MAX_MARKER_LENGTH + 2) continue;
    const match = MARKER.exec(line.trim());
    if (match) markers.push({ line: i, page: Number(match[1]), total: Number(match[2]) });
  }
  if (markers.length === 0) return null;
  const total = markers[0].total;
  let previous = 0;
  for (const marker of markers) {
    if (marker.total !== total || marker.page <= previous || marker.page > total) return null;
    previous = marker.page;
  }

  const pages: PdfPage[] = [];
  let from = 0;
  for (const marker of markers) {
    pages.push({ page: marker.page, text: lines.slice(from, marker.line).join("\n").trim() });
    from = marker.line + 1;
  }
  const rest = lines.slice(from).join("\n").trim();
  if (rest) {
    const next = markers[markers.length - 1].page + 1;
    if (next <= total) pages.push({ page: next, text: rest });
    else pages[pages.length - 1].text = `${pages[pages.length - 1].text}\n\n${rest}`.trim();
  }
  return pages;
}

/**
 * The chunks of a text, each with the page it came from when the text is a PDF's. A chunk never crosses a page, so its page is exact; a
 * paragraph that runs over a page break becomes two chunks. Fragments too short to mean anything are dropped, as `chunkText` does, unless
 * they are all there is. Without pages this is `chunkText` and every page is null.
 */
export function chunkPages(text: string): PageChunk[] {
  const pages = splitPdfPages(text);
  if (!pages) return chunkText(text).map((chunk) => ({ text: chunk, page: null }));
  const all: PageChunk[] = pages.flatMap((p) => chunkText(p.text).map((chunk) => ({ text: chunk, page: p.page })));
  const meaningful = all.filter((chunk) => chunk.text.length >= MIN_CHUNK_CHARS);
  return meaningful.length > 0 ? meaningful : all;
}
