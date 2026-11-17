// Which pages of which paper an answer used (ROADMAP item 41). Pure. The pages come from the stored chunks the answer was built from, not from
// anything the model wrote, so the sentence cannot name a page the answer did not draw on.
export type PagesUsed = { sourceId: string; title: string; pages: number[] };

export function pagesUsed(citations: { sourceId: string; title: string; page: number | null }[]): PagesUsed[] {
  const bySource = new Map<string, PagesUsed>();
  for (const citation of citations) {
    if (citation.page === null) continue;
    const entry = bySource.get(citation.sourceId) ?? { sourceId: citation.sourceId, title: citation.title, pages: [] };
    if (!entry.pages.includes(citation.page)) entry.pages.push(citation.page);
    bySource.set(citation.sourceId, entry);
  }
  return [...bySource.values()].map((entry) => ({ ...entry, pages: entry.pages.sort((a, b) => a - b) }));
}

export function pagesSentence(used: PagesUsed): string {
  const { pages, title } = used;
  if (pages.length === 1) return `Used page ${pages[0]} of ${title}.`;
  const list = `${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;
  return `Used pages ${list} of ${title}.`;
}
