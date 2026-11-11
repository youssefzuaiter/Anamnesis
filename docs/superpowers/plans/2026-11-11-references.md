# References and Citations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep a list of papers and books, cite them in notes with `[@key]`, import them from BibTeX, and see an APA 7 reference list under every note that cites.

**Architecture:** A `Reference` row per work (additive migration). Pure modules do the hard parts: `lib/bibtex.ts` reads and writes BibTeX, `lib/citations.ts` finds citations in text, `lib/apa.ts` formats them. Notes render citations by substituting into already-parsed text nodes, the way `[[wiki links]]` are, and append a "References" section in the reading view. Nothing about a citation is stored in the note but its key.

**Tech Stack:** Prisma 7 migration, Next.js pages and server actions, no new dependency.

**Spec:** `ROADMAP.md` item 22: "References and citations (M to L, migration). Store papers, cite them in notes with `[@key]`, import BibTeX, build a bibliography. Useful for report writing." Owner rulings 2026-11-11: format ourselves (citeproc is CPAL/AGPL), **APA 7 only**.

## Global Constraints

- **Migration is additive**: one new table, nothing dropped or renamed (the previous release keeps working). SQL by `prisma migrate diff`, never `migrate dev`.
- Every query is scoped by the session's `userId`; a reference id from the browser is ownership-checked; another account's, a missing and a deleted one give the same `RESOURCE_NOT_FOUND`.
- **Key**: 1 to 100 characters, `^[A-Za-z0-9_][A-Za-z0-9_:.#$%&+?<>~/-]*$`, and does not end with one of `:.#$%&+?<>~/-` (pandoc's rule, so "[@a]." ends the key at `a`). Unique per account (`@@unique([userId, key])`).
- **Reference fields**: `type` one of `article`, `book`, `chapter`, `paper` (conference), `thesis`, `report`, `web`, `other`; `title` 1 to 1,000; `authors` 0 to 100 names, each `{ family, given? }` or `{ literal }`; `year` 1000 to 2100 or none; `container` (journal, book or proceedings title), `volume`, `issue`, `pages`, `publisher`, `edition`, `editors` (names), `institution`, `number`, `doi`, `url`, each optional and at most 1,000 characters; `bibtex` (the entry as imported) at most 20,000.
- **Hard delete**, after a `confirm()`: a note citing a deleted key shows it as unresolved, nothing in a note is lost.
- **BibTeX import**: at most 1 MB of text and 2,000 entries per run; preview first (new, unchanged, a key you already have with other content: kept as yours, problems with line numbers); Apply adds only the new ones.
- **Citation syntax** (pandoc): `[@key]`, `[@key, p. 3]`, `[@a; @b]`, `[see @a, chap. 2]`, `[-@a]` (year only), and a bare `@key` as a narrative citation only when that key is one of the account's references. Inside code nothing is a citation.
- **APA 7** in text: one author `(Family, 2017)`, two `(A & B, 2017)` and narrative `A and B (2017)`, three or more `(First et al., 2017)`, no year `n.d.`, same first-cited form and year `2017a`/`2017b` (letters by title order), a group author in full; several works in one bracket in reference-list order, separated by `; `. Reference list sorted by first author (or title when there is none), then year, then title; authors `Family, G. M.`, up to 20, then `…` and the last; titles kept as written (no recasing); DOI as `https://doi.org/…`, else the URL.
- An unresolved key renders as the text typed, dashed and with a title saying no reference has that key, never an error.

## Review Focus

1. BibTeX from Google Scholar, Zotero, IEEE Xplore and arXiv exports: `@string` macros, `#` concatenation, month macros, nested braces, `{\"o}`, `{\u{g}}`, `{\i}`, `{\c{s}}` (Turkish), `--` page ranges, `{BERT}` protected words, `and others`.
2. Hostile BibTeX: an unclosed brace, 1 MB of `{`, 2,001 entries, a 100,000-character field: refused or reported fast, nothing half-saved.
3. A note that cites keys it does not have, cites inside code, or mixes citations with `[[wiki links]]` and maths.
4. Two works by the same authors in the same year, and a group author.
5. The References page on a phone, and a deleted reference that notes still cite.

---

### Task 1: `lib/bibtex.ts` (pure)
**Produces:** `type RefName = { family: string; given?: string } | { literal: string }`; `type RefFields = { key; type; title; authors: RefName[]; year: number | null; container?; volume?; issue?; pages?; publisher?; edition?; editors?: RefName[]; institution?; number?; doi?; url? }`; `parseBibtex(text: string): { entries: (RefFields & { bibtex: string; line: number })[]; problems: { line: number; message: string }[] }`; `toBibtex(ref: RefFields): string`; `decodeLatex(text: string): string`; `parseNames(text: string): RefName[]`.
Type map: article→article, book/booklet→book, inbook/incollection→chapter, inproceedings/conference→paper, phdthesis/mastersthesis→thesis, techreport→report, online/electronic/www→web, else other. `journal`/`booktitle`→container, `number`→issue for articles else number, `school`→institution, `howpublished` url when it is `\url{…}`.
Tests (`tests/unit/bibtex.test.ts`): each Review Focus 1 shape, round trip `parseBibtex(toBibtex(x))` equals `x`, problems with line numbers for a broken entry while the next one still parses, and the hostile shapes of Review Focus 2 each under 200 ms.

### Task 2: `lib/citations.ts` and `lib/apa.ts` (pure)
**Produces:** `type CiteItem = { key: string; prefix: string; locator: string; suppressAuthor: boolean }`; `findCitations(text: string, known: (key: string) => boolean): ({ start: number; end: number; items: CiteItem[]; narrative: boolean })[]`; `citedKeys(markdown: string): string[]` (outside fences and inline code, first appearance order, at most 500); `apaContext(refs: RefFields[]): ApaContext` (sorting and year suffixes); `inTextApa(ctx, items, narrative): string`; `referenceApa(ctx, ref): { text: string; italic: boolean }[]`; `referenceListApa(ctx): RefFields[]`.
Tests (`tests/unit/citations.test.ts`, `tests/unit/apa.test.ts`): every syntax form, a bracket with no `@` is not a citation, `a@b.com` and `@someone` are not, trailing punctuation, each APA rule in Global Constraints with the exact strings, the six types' list entries against APA's own published examples, a 21-author list.

### Task 3: Data, service, actions
**Files:** migration `…_references`, `prisma/schema.prisma` (`Reference`), `repositories/reference-repository.ts`, `services/reference-service.ts`, `actions/references.ts`, `lib/reference-input.ts` (the Zod schema shared by the form and import).
**Produces:** `listReferences(userId)`, `getReference(userId, id)`, `referencesByKeys(userId, keys)`, `createReference(userId, input)`, `updateReference(userId, id, input)`, `deleteReference(userId, id)`, `previewImport(userId, text)`, `applyImport(userId, text)` (re-derives from the text, adds new only), `notesCiting(userId, key)` (strpos on `@key`, live notes, 50 newest).
Tests (`tests/integration/references.test.ts`): cross-account isolation for every function, a duplicate key refused, invalid input writes nothing, import preview counts, apply twice adds nothing the second time, a differing key is kept, the limits.

### Task 4: Citations in notes
**Files:** `components/note-content.tsx` (substitution beside wiki links; a References section), `app/(dashboard)/notes/[id]/page.tsx` (loads `referencesByKeys(citedKeys(content))`).
Tests (`tests/render/`): a note with citations renders the APA text and links, the list in order, unresolved keys dashed, nothing inside code, wiki links and maths still work.

### Task 5: Pages, sidebar, shortcut
`/references` (list, Add, Import BibTeX card with preview and Apply, empty state), `/references/new`, `/references/[id]` (APA entry, the BibTeX, Edit, Delete, "Cited in" notes), `/references/[id]/edit`; `NAV_GROUPS` Study gets References (`b`), an icon. e2e (`tests/e2e/references.spec.ts`): import a .bib with a preview, cite in a note, see the in-text and list, delete and see it unresolved, a stranger's id, the phone width in light and dark; the navigation-coverage list.

### Task 6: Exports
JSON export gains a `references` table (export coverage test); the vault zip gains `references.bib` written by `toBibtex` (vault test).

### Task 7: Record
CLAUDE.md "References and citations" (decisions, the APA rules kept and not kept, measured numbers), README, ROADMAP tick 22.
