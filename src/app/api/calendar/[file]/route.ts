import { tokenFromFile } from "@/lib/calendar-feed";
import { buildFeedForToken } from "@/services/calendar-feed-service";

/**
 * The calendar feed: `GET /api/calendar/<token>.ics`. The one route that is not behind the session,
 * because a phone calendar cannot sign in; the token in the address is the credential, so the address
 * is a bearer secret. A malformed token, an unknown one and one that was turned off are the same
 * answer, byte for byte, so nothing can be learned about which addresses ever existed. The token is
 * never logged here.
 */

/** What every response carries: no cache keeps a copy, the address does not travel in a Referer, no search engine indexes it. */
const PRIVATE = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
} as const;

function notFound() {
  return new Response("Not found", { status: 404, headers: { ...PRIVATE, "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const token = tokenFromFile(file);
  if (token === null) return notFound();

  let feed: string | null;
  try {
    feed = await buildFeedForToken(token);
  } catch (error) {
    // Say what failed, never which address was asked for.
    console.error("[ERROR] calendar feed:", error instanceof Error ? error.message : "unknown error");
    return new Response("Something went wrong.", { status: 500, headers: { ...PRIVATE, "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (feed === null) return notFound();

  return new Response(feed, {
    headers: { ...PRIVATE, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="anamnesis.ics"' },
  });
}
