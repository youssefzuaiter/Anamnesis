import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import type { RefFields } from "@/lib/bibtex";
import { apaContext, inTextApa, referenceApa, type ApaContext } from "@/lib/apa";
import { findCitations } from "@/lib/citations";

/*
 * Citations in a note's reading view (ROADMAP 22). Like [[wiki links]], they are substituted into text
 * the Markdown parser has already split from code, so nothing inside code becomes a citation. The
 * References list comes from the note's cited keys (lib/citations citedKeys, the same outside-code
 * rule), not from what happened to render, so it does not depend on the order React calls components.
 */

export type CitationContext = {
  apa: ApaContext;
  ids: Map<string, string>;
  /** The resolved keys the note cites, for the list. */
  cited: RefFields[];
};

export function citationContext(refs: { id: string; fields: RefFields }[], citedKeys: string[]): CitationContext {
  const apa = apaContext(refs.map((r) => r.fields));
  const ids = new Map(refs.map((r) => [r.fields.key, r.id]));
  const keys = new Set(citedKeys);
  return { apa, ids, cited: apa.order.filter((ref) => keys.has(ref.key)) };
}

const plain = (ref: RefFields, ctx: ApaContext) => referenceApa(ctx, ref).map((p) => p.text).join("");

function citeText(text: string, ctx: CitationContext, rest: (text: string) => ReactNode): ReactNode {
  const citations = findCitations(text, (key) => ctx.ids.has(key));
  if (citations.length === 0) return rest(text);
  const parts: ReactNode[] = [];
  let at = 0;
  citations.forEach((citation, index) => {
    if (citation.start > at) parts.push(<Fragment key={`t${index}`}>{rest(text.slice(at, citation.start))}</Fragment>);
    const raw = text.slice(citation.start, citation.end);
    const missing = citation.items.find((item) => !ctx.ids.has(item.key));
    if (missing) {
      parts.push(
        <span
          key={`c${index}`}
          title={`No reference has the key "${missing.key}"`}
          className="text-text-muted underline decoration-dashed decoration-[1.5px] underline-offset-[3px]"
        >
          {raw}
        </span>,
      );
    } else {
      const label = inTextApa(ctx.apa, citation.items, citation.narrative);
      const single = citation.items.length === 1 ? ctx.apa.byKey.get(citation.items[0].key) : undefined;
      parts.push(
        <Link
          key={`c${index}`}
          href={single ? `/references/${ctx.ids.get(single.key)}` : "#note-references"}
          title={single ? plain(single, ctx.apa) : undefined}
          className="text-accent-ink decoration-[1.5px] underline-offset-[3px] hover:underline"
        >
          {label}
        </Link>,
      );
    }
    at = citation.end;
  });
  if (at < text.length) parts.push(<Fragment key="end">{rest(text.slice(at))}</Fragment>);
  return <>{parts}</>;
}

/** `children` with citations substituted into its strings; `rest` handles the text between them. */
export function withCitations(children: ReactNode, ctx: CitationContext, rest: (text: string) => ReactNode): ReactNode {
  if (typeof children === "string") return citeText(children, ctx, rest);
  if (Array.isArray(children)) {
    return children.map((child, index) => <Fragment key={index}>{withCitations(child, ctx, rest)}</Fragment>);
  }
  return children;
}

/** The note's reference list, in APA order, or nothing when it cites no known work. */
export function NoteReferences({ ctx }: { ctx: CitationContext }) {
  if (ctx.cited.length === 0) return null;
  return (
    <section aria-labelledby="note-references" className="mt-6 border-t border-border-subtle pt-4">
      <h2 id="note-references" className="font-sans text-lg font-bold text-text">
        References
      </h2>
      <ul className="mt-3 flex flex-col gap-2.5">
        {ctx.cited.map((ref) => (
          // APA's hanging indent: the first line out, the rest in.
          <li key={ref.key} className="pl-8 -indent-8 break-words">
            {referenceApa(ctx.apa, ref).map((part, index) => (part.italic ? <i key={index}>{part.text}</i> : <Fragment key={index}>{part.text}</Fragment>))}{" "}
            <Link href={`/references/${ctx.ids.get(ref.key)}`} className="font-sans text-xs text-text-muted hover:text-text">
              Details
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
