// A web page to a note: the readable article, as Markdown. Pure: no network, no database.
//
// Mozilla Readability (the algorithm behind Firefox's Reader View) finds the article on a linkedom DOM
// and leaves the page's navigation, footers and scripts behind. Its cleaned HTML goes through the same
// unified family the app renders Markdown with (hast -> mdast -> Markdown with GFM tables), and on the
// way every link and image is made absolute and kept only if it is http(s). Raw HTML never reaches the
// note, so nothing in a clipped page can run when the note is shown.

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { fromHtml } from "hast-util-from-html";
import { toMdast } from "hast-util-to-mdast";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import type { Nodes, Parent, RootContent } from "mdast";

const MAX_TITLE = 200;
/** Less text than this is a login wall, an error page or a page of links, not an article. */
const MIN_ARTICLE_CHARS = 200;

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
 * heading begins the title and a separator follows it, the heading is the article's title.
 */
function articleTitle(title: string, heading: string): string {
  if (heading && title.startsWith(heading) && /^\s*[|\-–—:·•»]/.test(title.slice(heading.length))) return heading;
  return title;
}

/** The article on `html`, fetched from `url`, as a title and Markdown; null when the page has no article. */
export function extractArticle(html: string, url: URL): { title: string; markdown: string } | null {
  if (!/<[a-z!]/i.test(html)) return null;

  const { document } = parseHTML(html);
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
  const markdown = toMarkdown(root, { extensions: [gfmToMarkdown()] }).trim();
  if (!markdown) return null;

  const title = articleTitle(oneLine(article.title || document.title || ""), heading).slice(0, MAX_TITLE);
  return { title, markdown };
}
