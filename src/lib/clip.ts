// A web page to a note: the readable article, as Markdown. Pure: no network, no database.
//
// Mozilla Readability (the algorithm behind Firefox's Reader View) finds the article on a linkedom DOM
// and leaves the page's navigation, footers and scripts behind. Its cleaned HTML goes through the same
// unified family the app renders Markdown with (hast -> mdast -> Markdown with GFM tables), and on the
// way every link and image is made absolute and kept only if it is http(s). Raw HTML never reaches the
// note, so nothing in a clipped page can run when the note is shown.

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { Parser } from "htmlparser2";
import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import { toMdast } from "hast-util-to-mdast";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import type { Nodes, Parent, RootContent } from "mdast";
import { AppError } from "@/lib/api-response";
import { scanFences } from "@/lib/markdown-fences";

const MAX_TITLE = 200;
/** Less text than this is a login wall, an error page or a page of links, not an article. */
const MIN_ARTICLE_CHARS = 200;
/*
 * Limits on the page's shape, checked before the page is parsed. Readability's cost grows with the
 * number of elements times their depth, on the one Node process that serves every page: measured, 1,000
 * nested elements took 4.6 s, 4,000 took 105 s, and 5 MB of chains 250 deep took 176 s; building the
 * document is itself quadratic in depth (3 s at 100,000 levels). Real long pages measured on 2026-11-10:
 * Wikipedia's "United States" 21,828 elements and 34 deep (1.2 s to clip), Python's built-in types
 * 19,713 and 21, an arXiv paper 3,255 and 23. Both limits are about twice the largest seen.
 */
export const MAX_DEPTH = 64;
export const MAX_ELEMENTS = 50_000;

/**
 * Why `html` is refused before parsing, or null. Counted while streaming through htmlparser2, the
 * parser linkedom builds its document with, so the numbers are the ones the document would have, and
 * the count stops at the first limit passed.
 */
function shapeRefusal(html: string): string | null {
  let depth = 0;
  let elements = 0;
  let why: string | null = null;
  const parser = new Parser({
    onopentag() {
      if (why) return;
      if (++depth > MAX_DEPTH) why = "That page is nested too deeply to clip.";
      else if (++elements > MAX_ELEMENTS) why = "That page is too large to clip.";
      if (why) parser.pause();
    },
    onclosetag() {
      depth--;
    },
  });
  parser.end(html);
  return why;
}

function safeHref(raw: string | null | undefined, base: URL): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Absolute http(s) links and images only; a link that cannot be kept leaves its words; raw HTML goes. */
function clean(node: Nodes, base: URL): RootContent[] {
  if (node.type === "html") return [];
  if (node.type === "image") {
    const src = safeHref(node.url, base);
    return src ? [{ ...node, url: src }] : [];
  }
  if (node.type === "link") {
    const href = safeHref(node.url, base);
    const children = node.children.flatMap((child: Nodes) => clean(child, base)) as typeof node.children;
    return href ? [{ ...node, url: href, children }] : (children as RootContent[]);
  }
  if ("children" in node) {
    const parent = node as Parent;
    return [{ ...parent, children: parent.children.flatMap((child: Nodes) => clean(child, base)) } as RootContent];
  }
  return [node as RootContent];
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Page titles often end with the site's name ("Gradient descent | Example Blog"). When the page's own main
 * heading begins the title and a separator follows it, the heading is the article's title. A page with no
 * title is named by its heading.
 */
function articleTitle(title: string, heading: string): string {
  if (!title) return heading;
  if (heading && title.startsWith(heading) && /^\s*[|\-–—:·•»]/.test(title.slice(heading.length))) return heading;
  return title;
}

/** The article on `html`, fetched from `url`, as a title and Markdown; null when the page has no article. */
export function extractArticle(html: string, url: URL): { title: string; markdown: string } | null {
  if (!/<[a-z!]/i.test(html)) return null;

  const refusal = shapeRefusal(html);
  if (refusal) throw new AppError("VALIDATION_ERROR", refusal);

  // A valid page may leave out <html>, <head> and <body>. linkedom then takes the first element as the
  // document, so such a page is first given them the way a browser would (parse5, through hast).
  const { document } = parseHTML(/<html[\s>]/i.test(html) ? html : toHtml(fromHtml(html)));
  // Read before Readability runs: it rewrites the document it is given.
  const heading = oneLine(document.querySelector("article h1, main h1, h1")?.textContent ?? "");
  let article: ReturnType<Readability["parse"]>;
  try {
    article = new Readability(document as unknown as Document).parse();
  } catch {
    return null;
  }
  if (!article?.content || oneLine(article.textContent ?? "").length < MIN_ARTICLE_CHARS) return null;

  const mdast = toMdast(fromHtml(article.content, { fragment: true }));
  const [root] = clean(mdast, url) as unknown as Nodes[];
  // A note typesets $...$ as maths, so a dollar in the page's prose is written \$ (a literal dollar);
  // code keeps its own.
  const markdown = toMarkdown(root, {
    extensions: [gfmToMarkdown()],
    unsafe: [{ character: "$", inConstruct: "phrasing" }],
  }).trim();
  if (!markdown) return null;

  const title = articleTitle(oneLine(article.title || document.title || ""), heading).slice(0, MAX_TITLE);
  return { title, markdown };
}

const CUT_NOTE = "\n\n_…cut here: a note holds at most this much. The rest is at the source._";

/**
 * `text` cut to at most `max` characters when it is longer, ending with a line that says so. A code
 * block the cut falls inside is closed first, so the line is not shown as code, and a character made of
 * two UTF-16 units is never split.
 */
export function fitToNote(text: string, max: number): string {
  if (text.length <= max) return text;
  let reserve = 0;
  for (;;) {
    let kept = text.slice(0, Math.max(0, max - CUT_NOTE.length - reserve));
    if (/[\uD800-\uDBFF]$/.test(kept)) kept = kept.slice(0, -1);
    const { open } = scanFences(kept.split("\n"));
    const close = open ? `\n${open}` : "";
    // Room for the closing fence is taken from the text, which can move the cut out of the block.
    if (close.length <= reserve) return `${kept}${close}${CUT_NOTE}`;
    reserve = close.length;
  }
}
