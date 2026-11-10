# Web clipper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Paste a link, get the page's readable article as a note, with where it came from.

**Architecture:** A hardened server-side fetcher (`lib/safe-fetch.ts`) replaces the calendar's string-only guard for every URL the server fetches on a user's behalf: http(s) only, every DNS answer checked against private and special ranges at connect time (so a name or a redirect cannot point back inside), redirects followed by hand and re-checked (at most 3), a byte cap enforced while streaming, a total time cap. The page goes through Mozilla Readability on a linkedom DOM, the article HTML becomes Markdown through `hast-util-from-html` → `hast-util-to-mdast` → `mdast-util-to-markdown` (+ GFM), and `services/clip-service.ts` creates an ordinary note through the existing note service (so search, links and export just work).

**Tech Stack:** Node `http`/`https` with a custom `lookup` (no fetch dispatcher, no new HTTP dependency), `@mozilla/readability` 0.6.0, `linkedom`, `hast-util-to-mdast`, existing unified pieces.

**Spec:** `ROADMAP.md` item 20: "Paste a link, save the readable article as a note with its source. Reuse the SSRF guard (`assertFetchableUrl`); cap size and time."

## Global Constraints

- **Ruling on the spec:** "reuse the guard" becomes "replace it with one both features use": the existing guard checks only the host text (no DNS), follows redirects unchecked, misses `0.0.0.0`, IPv6 private ranges, `100.64.0.0/10` (Tailscale), `host.docker.internal` and dotless compose names, and reads whole bodies before measuring them.
- Refused destinations (after DNS, for every address): IPv4 `0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.168/16, 198.18/15, 224/4, 240/4, 255.255.255.255`; IPv6 `::, ::1, fc00::/7, fe80::/10, ff00::/8, 64:ff9b::/96` and IPv4-mapped forms of the IPv4 list. Hostnames without a dot are refused before DNS. Ports other than 80/443 are allowed only for http(s) on a public address.
- Caps: 5 MB of body, 15 s in all, 3 redirects; content type must be `text/html` or `application/xhtml+xml`.
- Messages say what happened without echoing the address's resolution ("That address is not reachable from this server.", "That page is too large to clip (over 5 MB).", "That page took too long to answer.", "That link does not lead to a web page.", "Could not find an article on that page.").
- The note: title = the article title (trimmed to 200, else the URL's host), content = `> Source: [<host>](<url>) · clipped <date>` then the Markdown body, tag `clipped`. No raw HTML in the note; links keep only http(s) targets; images keep http(s) `src` only.
- No migration. One action `clipUrlAction(formData)`; the browser sends a URL, never a host list.
- Calendar subscriptions switch to the same fetcher (its own caps unchanged: 20 s, 5 MB, webcal→https).

## Review Focus

1. DNS answers that are private (a public-looking name pointing at 127.0.0.1, 10.x, 100.x, ::1), and a redirect from a public page to a private one: refused, nothing fetched inside.
2. A body that never ends, a huge body, a slow drip: stopped at 5 MB or 15 s, memory bounded.
3. Hostile HTML: scripts, inline handlers, `javascript:` links, data URLs, enormous nesting: none survive into the note.
4. Not an article (a PDF, JSON, an empty page, a login wall): a clear message and no note.
5. Non-ASCII and RTL text, a title with Markdown characters, a page whose `<title>` is empty.

---

### Task 1: `lib/safe-fetch.ts`, the guarded fetcher
Produces `isBlockedAddress(ip: string): boolean`, `assertPublicUrl(raw: string, schemes?: string[]): URL`, `safeFetchText(url: URL, opts: { maxBytes: number; timeoutMs: number; accept: string; allow?: (contentType: string) => boolean; lookup?: LookupFn }): Promise<{ text: string; finalUrl: URL; contentType: string }>` throwing `AppError` with the messages above. Unit tests for every range (both families, mapped forms, edge addresses) and URL forms (dotless, `0x7f.1`, `2130706433`, userinfo, ports); integration tests with real local HTTP servers and an injected `lookup` (so a "public" name resolves to 127.0.0.1 and is refused at connect time; a redirect chain; 4 redirects; a body over the cap; a server that drips; wrong content type).

### Task 2: Calendar subscriptions on the new fetcher
`calendar-service.ts` uses `assertPublicUrl(raw, ["http:", "https:", "webcal:"])` and `safeFetchText`; its existing tests stay green; the old local `assertFetchableUrl` is removed.

### Task 3: `lib/clip.ts`, page to Markdown (pure)
Produces `extractArticle(html: string, url: URL): { title: string; markdown: string } | null` (Readability on linkedom; hast → mdast → Markdown with GFM; drops non-http(s) links and images; null when Readability finds nothing). Unit tests on fixture pages (an article with headings, lists, a table, code; script/onclick/javascript:/data: removal; a non-article; Turkish and Arabic text; a title with `*` and `[`).

### Task 4: `services/clip-service.ts` + `actions/clip.ts`
`clipUrl(userId, rawUrl, fetcher = safeFetchText): Promise<{ noteId: string; title: string }>` creates the note through the note service (tag `clipped`, source line); integration tests through a local server via an injected `lookup` allowance (never an env switch): note content, tag, title fallback, refusal leaves no note, another account's notes untouched.

### Task 5: UI and browser test
A "Clip a web page" card on `/notes/import` (URL field, button, status, opens the new note). e2e: a private address and a non-URL are refused with the messages; nothing created. (A real public page is not fetched in CI.)

### Task 6 (after review): Record
`CLAUDE.md` section "Web clipper" (+ the calendar guard change), README, ROADMAP tick 20.
