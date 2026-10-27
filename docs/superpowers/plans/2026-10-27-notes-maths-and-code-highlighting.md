# Maths and code highlighting in notes: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A note's reading view shows typeset maths (`$...$` inline, `$$...$$` block) and syntax-highlighted code.

**Architecture:** One pure module configures the unified plugins for react-markdown. Note Markdown is rendered on the server and handed to the client `NoteView` as a ready node, so KaTeX and the highlighter never reach the browser bundle. Highlight colours come from the app's CSS tokens, so they follow light and dark.

**Tech Stack:** react-markdown 10, remark-gfm 4, remark-math 6, rehype-katex 7, katex 0.19, rehype-highlight 7 (lowlight), Tailwind 4 tokens, `node:test`, Playwright.

**Spec:** the description approved in chat on 2026-10-27, and `ROADMAP.md` item 1. A small change, so there is no separate spec file.

## Global Constraints

- Free and local only: no network at runtime, no paid service.
- Maths syntax: `$...$` inline and `$$...$$` block; `\$` is a literal dollar sign.
- An invalid formula shows as the text the person typed, in the warning colour (`--warn`). Never an error page, never a thrown render.
- A code fence with no language stays plain (`detect: false`); an unregistered language is plain too, not an error.
- No stock highlight.js theme: every colour is a token from `src/app/globals.css`, so light and dark follow `data-theme`.
- KaTeX and the highlighter must not be in the client bundle. Wiki links (`[[Title]]`) keep working.
- Raw HTML in a note stays escaped. KaTeX `trust` stays off.
- Search, the assistant, export and backups keep using the raw text; nothing about storage changes.
- Project rules in `CLAUDE.md` apply: layering, Quiet Studio tokens, 12px text floor, contrast measured not eyeballed, `pnpm build` before calling it done.

## Review Focus

Each line has its test in the task named.

1. A fence naming a language highlight.js does not know (for example `lean`) renders plain and does not throw. (Task 1)
2. A very wide display formula on a 375px phone scrolls inside its own box; the page does not widen. (Task 2)
3. Two bare dollar amounts on one line (`$5 and $10`) are read as maths, which is the documented trade-off; `\$5` keeps them as text. (Task 1)
4. Hostile input stays inert: `<script>` stays escaped and `\href{javascript:...}` never becomes a link. (Task 1)
5. A note that is only a formula renders, and an empty note still shows the empty message (that message moves from `NoteView` to the page). (Task 2)

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/markdown.ts` (create) | The plugin lists and their options. Pure: no Prisma, no env, no React. |
| `tests/render/markdown.test.ts` (create) | Renders Markdown through those plugins with `react-markdown` and `react-dom/server` and asserts on the HTML. |
| `package.json` (modify) | Four dependencies; the `test` script also runs `tests/render`. |
| `src/components/note-content.tsx` (modify) | Server component (drop `"use client"`); uses the plugins; imports KaTeX's CSS; block styling moves to `pre`. |
| `src/components/note-view.tsx` (modify) | Takes `body: ReactNode` instead of `content` and `links`. |
| `src/app/(dashboard)/notes/[id]/page.tsx` (modify) | Renders `NoteContent` (or the empty message) and passes it as `body`. |
| `src/app/globals.css` (modify) | Syntax colours from tokens; `.katex-display` scrolls inside itself. |
| `tests/e2e/workspace.spec.ts` (modify) | One browser test for maths, code, a bad formula and phone width. |

The render tests live in their own folder because `pnpm test` runs with the `react-server` condition, under which `react-dom/server` refuses to load (checked: "not supported in React Server Components").

### Task 1: The plugin configuration, proven by rendering

**Files:**
- Create: `src/lib/markdown.ts`, `tests/render/markdown.test.ts`
- Modify: `package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Produces: `export const remarkPlugins: NonNullable<Options["remarkPlugins"]>` and `export const rehypePlugins: NonNullable<Options["rehypePlugins"]>` (with `Options` from `react-markdown`). Task 2 passes both to `<Markdown>`.

- [ ] **Step 1: Install**

Run: `pnpm add remark-math rehype-katex katex rehype-highlight`
Expected: four entries in `dependencies`; the lockfile passes the supply-chain check. If `katex` is refused for being too new, pin the previous patch and note it.

- [ ] **Step 2: Write the failing tests** in `tests/render/markdown.test.ts`, with a local helper `render(md: string): string` that calls `renderToStaticMarkup(createElement(Markdown, { remarkPlugins, rehypePlugins }, md))`. Tests and their assertions:
  - `renders inline maths`: `"The loss is $E = mc^2$ here."` contains `class="katex"` and `<math`, and does not contain `$E`.
  - `renders block maths`: `"$$\n\\frac{a}{b}\n$$"` contains `katex-display`.
  - `an invalid formula falls back to its source in the warning colour`: `"$\\frac{1$"` does not throw, contains `katex-error`, `\frac{1` and `var(--warn)`.
  - `a backslash-escaped dollar is text`: `"It costs \\$5 and \\$10."` has no `katex` and contains `$5 and $10`.
  - `two bare dollar amounts are read as maths (documented)`: `"It costs $5 and $10."` contains `class="katex"`.
  - `named-language code is highlighted`: a `python` fence contains `hljs-keyword` and `language-python`.
  - `a fence with no language stays plain`: no `hljs-` anywhere.
  - `an unregistered language does not throw and stays plain`: a `lean` fence renders, contains its text, no `hljs-`.
  - `raw HTML stays escaped`: `"<script>alert(1)</script>"` yields no `<script`.
  - `maths cannot smuggle a link`: `"$\\href{javascript:alert(1)}{x}$"` yields no `<a ` and no `href=`.
  - `maths and code in one note both render`: a note with both contains `class="katex"` and `hljs-keyword`.
  - `an accented letter in a formula does not write a KaTeX warning to the console`: `"$é + 1$"` leaves `console.warn` uncalled. (Added while building: KaTeX warns on this by default, which would fill the server log for Turkish text.)

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm exec tsx --test tests/render/markdown.test.ts`
Expected: FAIL, cannot find `@/lib/markdown`.

- [ ] **Step 4: Implement `src/lib/markdown.ts`**

`remarkPlugins = [remarkGfm, remarkMath]`. `rehypePlugins = [[rehypeKatex, { errorColor: "var(--warn)", strict: "ignore" }], [rehypeHighlight, { detect: false }]]`. Add a comment saying why `trust` is left at its default (off).

  *Corrected while building (mutation-tested, see the ledger):* the first draft also set `throwOnError: false` and `ignoreMissing: true`. Both are no-ops: `rehype-katex` always catches formula errors itself and shows the typed text, and `rehype-highlight` never throws on an unknown language, it only records a warning. The plugin order does not change the output either; KaTeX is listed first only to avoid that warning for every formula.

- [ ] **Step 5: Wire the test script**

Change `"test"` in `package.json` to run the existing command, then `tsx --test "tests/render/*.test.ts"` (without the `react-server` condition).

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm exec tsx --test tests/render/markdown.test.ts` then `pnpm test`
Expected: all pass, and the existing unit tests are still counted.

- [ ] **Step 7: Commit** the two source files, `package.json` and the lockfile.

### Task 2: Notes render maths and code on the server

**Files:**
- Modify: `src/components/note-content.tsx`, `src/components/note-view.tsx`, `src/app/(dashboard)/notes/[id]/page.tsx`, `src/app/globals.css` (only the `.katex-display` rule), `tests/e2e/workspace.spec.ts`

**Interfaces:**
- Consumes: `remarkPlugins`, `rehypePlugins` from Task 1.
- Produces: `NoteView({ header?, body, editor }: { header?: ReactNode; body: ReactNode; editor: ReactNode })`. `NoteContent({ content, links })` keeps its signature but is now a server component.

- [ ] **Step 1: Write four failing e2e tests** (each creates its own note, and asserts inside `main`):
  - `a note shows typeset maths and highlighted code, and a bad formula does not break the page`: content has an inline formula, a `$$` block, a broken formula, a `python` fence and `\$5 and \$10`. Assert `.katex` visible, `.katex-display` count 1, `.katex-error` count 1, `.hljs-keyword` visible, and the text contains `$5 and $10`.
  - `a very wide formula scrolls inside its own box on a phone`: viewport 375×812, a `$$` block of about 80 terms, then `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
  - `a note that is only a formula still renders`: content is `$x$`; `.katex` visible.
  - `an empty note still shows the empty message`: title only (content may be empty); the text contains `This note is empty`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec playwright test -g "typeset maths|wide formula|only a formula|empty note"` (dev server on 3100)
Expected: the first three FAIL (no `.katex`); the empty-note test already passes, which pins today's behaviour before the message moves.

- [ ] **Step 3: Implement.** In `note-content.tsx`: remove `"use client"`; pass the plugin lists; `import "katex/dist/katex.min.css"`; add a `pre` component carrying the block styling (background, padding, `overflow-x-auto`, mono 13px) and make the `code` component always inline-styled, with `pre > code` resetting its own background and padding (arbitrary variants on the `pre`), so a fence looks the same with or without a language. Keep the incoming `className` on `code` so `hljs` and `language-*` survive. In `globals.css` add `.katex-display { overflow-x: auto; overflow-y: hidden }`. In `note-view.tsx` replace the `content` and `links` props with `body: ReactNode`, drop the `NoteContent` import and the empty-note message. In the page, build `body` as `<NoteContent content={note.content} links={linkTargets} />` when `note.content.trim()` is non-empty, else the empty-note paragraph (same copy as before), and pass it.

- [ ] **Step 4: Run to verify they pass**

Run: the two e2e tests, then `pnpm test:e2e` for the whole suite.
Expected: all pass, including the existing note tests (heading and list read back, wiki links).

- [ ] **Step 5: Commit.**

### Task 3: Syntax colours from the tokens, measured

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Measure first.** Compute WCAG contrast of each token against `--surface-subtle` (the code block ground) in both themes: `text-faint`, `accent-ink`, `ok`, `warn`, `text`, `danger`. Expected: every pair at or above 4.5:1. If one is not, pick the nearest token that is and note why.

- [ ] **Step 2: Add the rules.** Comments and quotes use `text-faint` (italic); keywords, built-ins and types use `accent-ink`; strings, regexps and additions use `ok`; numbers, literals and symbols use `warn`; titles and sections use `text` at weight 600; deletions use `danger`. Selectors are the `.hljs-*` classes highlight.js 11 emits.

- [ ] **Step 3: Look at it.** Open a note with `python`, `typescript`, `json` and `bash` fences at desktop and 375px, in light and dark, and read the screenshot, not just the DOM.

- [ ] **Step 4: Commit.**

### Task 4: Verify, record and ship

- [ ] **Step 1: Guard.** Run `security-review` on the diff (a new rendering path for user text; KaTeX options; `trust` off; no raw HTML).
- [ ] **Step 2: Check.** `simplify`, then `verification-before-completion` and `verification-loop`: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e` (background priority). Then confirm the bundle claim: after `pnpm build`, `grep -rl "KaTeX parse error" .next/static` finds nothing while `.next/server` does.
- [ ] **Step 3: Review.** `code-review` on the diff; fix findings.
- [ ] **Step 4: Record.** Add a "Maths and code in notes" section to `CLAUDE.md` (decisions, the money-sign trade-off, the `react-server` test finding, measured contrast, bundle check). Mention maths and highlighting in the README's Notes line. Tick item 1 in `ROADMAP.md`.
- [ ] **Step 5: Ship.** Commit, push `notes-math`, open a pull request (never a push to `main`), report the checks. The plan file is committed with it.
