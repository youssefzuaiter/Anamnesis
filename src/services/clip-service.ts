import "server-only";
import { AppError } from "@/lib/api-response";
import { extractArticle, fitToNote } from "@/lib/clip";
import { dateLabel } from "@/lib/note-templates";
import { assertPublicUrl, safeFetchText, SafeFetchError } from "@/lib/safe-fetch";
import { MAX_NOTE_LENGTH } from "@/lib/see-also";
import * as noteService from "@/services/note-service";

/*
 * The web clipper: a link in, a note out. The server fetches the page through the guarded fetcher (no
 * private or local destination, every redirect checked, 5 MB and 15 s at most), keeps the readable
 * article as Markdown, and makes an ordinary note of it through the note service, so search, links,
 * versions and the export treat it like any other.
 */

const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

type FetchPage = (url: URL) => Promise<{ text: string; finalUrl: URL }>;

const fetchPage: FetchPage = (url) =>
  safeFetchText(url, {
    maxBytes: MAX_PAGE_BYTES,
    timeoutMs: TIMEOUT_MS,
    accept: "text/html, application/xhtml+xml;q=0.9",
    allow: (type) => type.startsWith("text/html") || type.startsWith("application/xhtml+xml"),
  });

/** What the person reads when the page could not be fetched, worded for clipping. */
function clipFailure(error: SafeFetchError): AppError {
  switch (error.kind) {
    case "too-large":
      return new AppError("VALIDATION_ERROR", "That page is too large to clip (over 5 MB).");
    case "type":
      return new AppError("VALIDATION_ERROR", "That link does not lead to a web page.");
    case "timeout":
      return new AppError("INTEGRATION_ERROR", "That page took too long to answer.");
    case "status":
      return new AppError("INTEGRATION_ERROR", `The page answered ${error.status}.`);
    default:
      return error;
  }
}

export async function clipUrl(
  userId: string,
  rawUrl: string,
  deps: { fetch?: FetchPage; now?: Date } = {},
): Promise<{ noteId: string; title: string }> {
  const url = assertPublicUrl(rawUrl);

  let page: { text: string; finalUrl: URL };
  try {
    page = await (deps.fetch ?? fetchPage)(url);
  } catch (error) {
    throw error instanceof SafeFetchError ? clipFailure(error) : error;
  }

  const article = extractArticle(page.text, page.finalUrl);
  if (!article) throw new AppError("VALIDATION_ERROR", "Could not find an article on that page.");

  const source = page.finalUrl;
  // The link is written in angle brackets so a URL with parentheses stays one link.
  const header = `> Source: [${source.hostname}](<${source.href}>) · clipped ${dateLabel(deps.now ?? new Date())}\n\n`;
  const content = fitToNote(`${header}${article.markdown}`, MAX_NOTE_LENGTH);

  const note = await noteService.createNote(userId, {
    title: (article.title || source.hostname).slice(0, 200),
    content,
    tags: ["clipped"],
    isFavorite: false,
    projectId: null,
    courseId: null,
  });
  return { noteId: note.id, title: note.title };
}
