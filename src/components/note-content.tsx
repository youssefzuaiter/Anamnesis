import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { MarkdownAsync, type Components } from "react-markdown";
import "katex/dist/katex.min.css"; // rehype-katex does not import its own CSS
import { remarkPlugins, rehypePlugins } from "@/lib/markdown";
import { wikiLinkPattern, normalizeTitle } from "@/lib/wiki-links";

/**
 * Renders note text as Markdown for reading.
 *
 * react-markdown builds React elements rather than setting innerHTML, and no
 * raw-HTML plugin is enabled, so a note containing `<script>` renders as the
 * literal characters. That matters here: note content is not always typed by
 * the author — an imported PDF is whatever the file contained.
 *
 * This is a server component on purpose. KaTeX and the syntax highlighter are
 * large, so a note is turned into HTML on the server and only that HTML
 * reaches the browser; the page hands the result to the client NoteView as a
 * ready-made node.
 */

/**
 * `[[Title]]` is this app's own syntax, not Markdown's, so it is substituted
 * into the already-parsed text nodes rather than handed to the parser. Working
 * on text nodes is what keeps a `[[link]]` inside a code fence from turning
 * into a link.
 */
function withWikiLinks(text: string, links: Map<string, string | null>): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  const pattern = wikiLinkPattern();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));

    const title = match[1].trim();
    const id = links.get(normalizeTitle(title)) ?? null;

    parts.push(
      id ? (
        <Link
          key={`w${key++}`}
          href={`/notes/${id}`}
          className="text-accent-ink underline decoration-[1.5px] underline-offset-[3px] hover:decoration-2"
        >
          {title}
        </Link>
      ) : (
        <span
          key={`w${key++}`}
          title="No note with this title yet"
          className="text-text-muted underline decoration-dashed decoration-[1.5px] underline-offset-[3px]"
        >
          {title}
        </span>
      ),
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

function linkifyChildren(
  children: ReactNode,
  links: Map<string, string | null>,
): ReactNode {
  if (typeof children === "string") return withWikiLinks(children, links);
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{linkifyChildren(child, links)}</Fragment>
    ));
  }
  return children;
}

export async function NoteContent({
  content,
  links,
}: {
  content: string;
  /** Normalized note title → its id, or null when nothing resolves. */
  links: Record<string, string | null>;
}) {
  const map = new Map(Object.entries(links));
  const linkify = (children: ReactNode) => linkifyChildren(children, map);

  const components: Components = {
    h1: ({ children }) => (
      <h2 className="mt-4 font-sans text-xl font-bold leading-snug tracking-tight text-text">
        {linkify(children)}
      </h2>
    ),
    h2: ({ children }) => (
      <h3 className="mt-3 font-sans text-lg font-bold leading-snug text-text">
        {linkify(children)}
      </h3>
    ),
    h3: ({ children }) => (
      <h4 className="mt-2 font-sans text-base font-semibold text-text">{linkify(children)}</h4>
    ),
    p: ({ children }) => <p>{linkify(children)}</p>,
    li: ({ children }) => <li>{linkify(children)}</li>,
    ul: ({ children }) => (
      <ul className="list-disc space-y-1 pl-6">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal space-y-1 pl-6">{children}</ol>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-ink underline decoration-[1.5px] underline-offset-[3px]"
      >
        {children}
      </a>
    ),
    blockquote: ({ children }) => (
      <blockquote className="rounded-xl bg-surface-subtle px-5 py-4 font-sans text-[15px] leading-relaxed text-text">
        {children}
      </blockquote>
    ),
    // The block look lives on <pre>, so a fence is the same block with or
    // without a language; <code> inside it drops its inline-code look.
    // `className` is kept so the highlighter's `hljs` and `language-*`
    // classes survive.
    pre: ({ children }) => (
      <pre className="overflow-x-auto rounded-lg bg-surface-subtle p-4 font-mono text-[13px] leading-relaxed [&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]">
        {children}
      </pre>
    ),
    code: ({ className, children }) => (
      <code
        className={`rounded bg-surface-subtle px-1 py-0.5 font-mono text-[0.85em] ${className ?? ""}`}
      >
        {children}
      </code>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left font-sans text-sm">
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b border-border-strong px-2 py-1.5 font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-border-subtle px-2 py-1.5">
        {children}
      </td>
    ),
    hr: () => <hr className="border-border-subtle" />,
  };

  // A note must never take its own page down. Very odd input (code nested
  // thousands of levels deep, say) can overflow the stack while rendering, and
  // an imported file can hold anything. Rendering is awaited here so that can be
  // caught, and the note falls back to its raw text, with the Edit button intact.
  // Only the awaited call sits in the try: JSX built inside it would not be
  // covered, since React renders it later.
  let rendered: ReactNode = null;
  try {
    rendered = await MarkdownAsync({
      remarkPlugins,
      rehypePlugins,
      components,
      children: content,
    });
  } catch (error) {
    console.error("Could not render a note's Markdown:", error);
  }

  if (rendered === null) {
    return (
      <div className="flex max-w-[68ch] flex-col gap-3">
        <p className="font-sans text-sm text-text-muted">
          This note could not be displayed as formatted text, so its raw text is
          shown instead. Use Edit to change it.
        </p>
        <pre className="whitespace-pre-wrap break-words rounded-lg bg-surface-subtle p-4 font-mono text-[13px] leading-relaxed text-text">
          {content}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex max-w-[68ch] flex-col gap-4 font-serif text-[17px] leading-[1.75] text-text">
      {rendered}
    </div>
  );
}
