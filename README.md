# Anamnesis

A private, self-hosted workspace for your notes, tasks, calendar, projects, goals, courses and flashcards. It includes an AI assistant that answers questions from your own writing and shows where each answer came from.

Everything runs on your own machine. Your records stay in your own PostgreSQL database, and the AI models run locally through Ollama, so no paid AI API or cloud AI service is involved.

> **Status:** a working personal project. It is not deployed publicly. See [Limitations](#limitations).

---

## What it is

Anamnesis brings together parts of academic and personal life that usually sit in separate tools:

- **Notes** in Markdown, with typeset maths (`$...$` inline, `$$...$$` as a block, rendered by KaTeX) and syntax-highlighted code, templates for lectures, Cornell notes, paper summaries and meetings, version history and restore, `[[wiki links]]` with backlinks, suggested links and unlinked mentions on each note (a click adds the link under "See also"; nothing is written on its own), a graph view, tags, favourites, attachments, references and citations (keep papers and books, import them from BibTeX, cite one in a note as `[@key]` and get an APA 7 reference list under the note), a web clipper (paste a link, or share a page from your phone, and the page's readable article becomes a note that says where it came from; only public pages are fetched), and import from PDF files, Markdown files and a whole vault zip (Obsidian's, or the one Settings downloads: notes, tags and attachments, with a preview before anything is saved and no duplicates when you import it twice).
- **Tasks** with due dates, priorities, tags, repeating schedules, and time blocks you can drag onto the hour they should happen. A task has its own **checklist** of up to 50 steps (add, tick, rename, reorder with Up and Down, remove); "2 of 5 done" shows on the task and `2/5` in the list, and ticking every step does not finish the task or move a project's or goal's progress.
- **Calendar** with a month view and an hourly week and day grid (drag a block to move it, drag its top or bottom edge to resize it in 15-minute steps, or select it and use the buttons on a phone or from a keyboard; drop an unscheduled task on the hour it should happen; imported timetable entries are read-only), repeating events (on an occurrence of a series, a choice applies what you changed to this and the later occurrences too; each keeps its own date), read-only import of `.ics` feeds such as university timetables, and a read-only `.ics` address of your own (Settings, Calendar feed) that a phone calendar can subscribe to: your events, and your open tasks as free-time entries on their planned time or all day on their due date.
- **Projects and goals.** A project's progress is calculated from its tasks, and its tasks can be shown as a **Board** (To do, In progress, Done) that you drag cards across on a desktop, move with the buttons on each card from a keyboard or a phone, and see one column at a time on a small screen. A goal's progress is calculated from its own tasks and from the projects linked to it.
- **Courses** with assessments, a grade calculator that shows what you need on the remaining work, a GPA tracker (credits and your official final letter per course, a cumulative and per-term GPA, and what the open courses must average to reach a target) and an exam-prep summary. An exam prep planner spreads review sessions over the days before an assessment, in the free gaps of your calendar, and adds them as planned tasks once you confirm.
- **Flashcards and review.** Spaced repetition using the SM-2 algorithm. Cards can be generated from a note, written by hand, or made from words you select in a note, including fill-in-the-blank cards written as `{{c1::answer}}` (one card for each number). Each course is a deck you can review on its own.
- **Quiz me.** From a note or a course, answer questions in your own words. Your cards come first; if there are fewer than you asked for, the model writes the rest from your notes. Obvious answers (an exact match, or "I don't know") are checked without a model and the model suggests a verdict for the rest, but nothing about a card's schedule changes until you choose a grade. With Ollama off the quiz still runs on your cards and you grade yourself.
- **Reminders on your phone.** With the self-hosted ntfy server set up (see `ops/README.md`), a morning list of what is due today and a heads-up before events and planned tasks reach your phone through the ntfy app even when no Anamnesis tab is open. Off by default; titles can be hidden.
- **Study time per course.** Two recorders you switch on yourself, both off by default: how long you wrote in a note (and, as a third switch, which course the note was in) and how long the study timer ran on a task. The Focus page and each course page show the recorded time per course, the two kinds side by side and never added together, as an observation rather than a score. It never stores what you wrote or what you worked on.
- **Search.** Semantic search finds content by meaning. The command palette (Ctrl+K or ⌘K) does quick literal search and navigation.
- **Assistant.** Ask questions about your workspace and get cited answers. It can also propose new tasks, events, notes or goals, and two edits: adding text to the end of a note ("append this summary to my thesis notes") or moving a task to another day. You see exactly what would change, and nothing happens until you confirm. On any note, an imported PDF included, it can also draft a summary as a new note: the key points of each part, kept only when the note's own words back them, which you read before saving. On the assistant page you can limit a question to one course, one project or one note ("Ask about"), from the control or from the "Ask about this course / project / note" links.
- **Audit log and trash.** Every assistant proposal and your decision is recorded. Deleted notes, tasks, projects and goals go to a trash, where you can restore them or delete them permanently.
- **Keyboard shortcuts.** Ctrl or ⌘ + K jumps to anything and Ctrl or ⌘ + J opens the assistant. Press `g`, then a letter (`g` `n` for notes, `g` `t` for tasks) to go to a page, and `?` for the full list. The single-key shortcuts pause while you type in a field and can be switched off from that list.
- **Dashboard.** Today's tasks and schedule, recent notes, active projects and goals, and a "Plan my day" button. It proposes a plan that fits open tasks into your free time and changes nothing until you confirm.
- **Daily note and Shut down day.** One button opens today's note, started with that day's schedule and open tasks, and finds the same note again after that. "Shut down day" lists what is unfinished (tasks due today ticked, overdue ones left for you to tick) and moves the ones you confirm to tomorrow.

Each account on an instance is separate from the others. Data access is scoped to the signed-in user, and tests check that one account cannot see another's data.

---

## Goal of the project

Anamnesis has four aims.

1. **One place for connected work.** Notes, tasks, events, projects, goals and courses are linked, so you can move from one to another.
2. **An assistant you can check.** Answers come from your own content and cite it. The assistant can only propose: new items, adding to a note, or moving a task, never deleting or rewriting anything, and every proposal and its outcome is logged.
3. **Private by default.** There are no paid AI APIs and no analytics or tracking code. Your records stay in your own database and on your disk. Writing-behaviour tracking is off unless you turn it on, and it records how long and how much you write, never what you write.
4. **A serious engineering project.** It is built to show how an AI-powered application should be made: retrieval with citations, tool calling with human confirmation, security enforced in code rather than by the model's behaviour, automated tests, AI evaluation suites, and continuous integration.

---

## The name

**Anamnesis** (Greek *anámnēsis*) means recollection. In Plato's *Meno* and *Phaedo*, learning is recollection: the mind recalls what it already knows. The assistant does something similar with your own writing: it helps you recall what you have recorded. In medicine, "anamnesis" also means a patient's history, which suits a personal record.

**The logo** is an open spiral that unwinds from a single point. Three dots along it are memories already recalled, and the terracotta dot at the outer end is the recall happening now.

Colours: ink `#2b2622`, terracotta `#b5532f`, parchment `#efe9db` (the app's background colour).

**Naming status.** The project was developed under a working name, Nexus. Everything a person sees now says Anamnesis: the sidebar, page titles, the sign-in screen, the installable app's name and its icon. The working name remains in three places that are not on screen: the package name, the title of the engineering specification, and the assistant's system prompt, which is left alone because its behaviour is measured by the evaluation suite.

---

## How the assistant works

1. **Retrieval.** Each note, task, event, project, course and goal is converted to a text passage and stored as an embedding in pgvector. A question is embedded the same way and matched against the closest passages. Only passages above a relevance threshold are used, and that threshold was measured against the embedding model.
2. **Answering.** The local chat model (`llama3.2:3b`) writes an answer from those passages, with numbered citations. A citation to a note links to that note.
3. **Proposing actions.** For requests such as "add a task to…" or "set a goal to…", the model can call one of four create-only tools: task, event, note or goal. Each proposal appears as a card. Nothing is created until you confirm, and declining is logged too.
4. **Where the security comes from.** The user ID always comes from the server-side session, never from the request. Retrieved text is treated as data, not instructions. Tool-call arguments are validated with Zod before anything reaches the database.

A small local model can be tricked by hostile text, so the design assumes it can be. A tricked model can only propose new items, and the user must confirm them. It also cannot see another account's data, because that data never enters its context.

If Ollama is not running, the notes page falls back to keyword matching and says so. The `/search` page, which searches everything by meaning, shows a message instead. The command palette (Ctrl+K or ⌘K) is always literal search, so it works without Ollama.

---

## Tech stack

| Area | Choice |
| --- | --- |
| Web framework | Next.js 16 (App Router), React 19, TypeScript |
| Database | PostgreSQL 17 with pgvector (exact similarity search, no vector index) |
| ORM | Prisma 7 with the `pg` driver adapter |
| Authentication | Auth.js (NextAuth v5 beta), email and password, JWT sessions |
| Validation | Zod, for form input and AI tool calls |
| Local AI | Ollama: `llama3.2:3b` for chat and tool calling, `nomic-embed-text` for 768-dimension embeddings |
| Styling | Tailwind CSS 4 |
| Testing | Node test runner (unit and integration), Playwright (end-to-end), custom AI evaluation suite |
| CI | GitHub Actions |

---

## Architecture

Every feature follows the same request path:

```
UI → Server Action / API route → Zod validation → authorization (userId from session)
   → service (business rules, search index upkeep) → repository (Prisma, always scoped by userId)
```

Main directories:

```
src/
├── app/            Routes: dashboard pages, (auth) pages, API routes
├── actions/        Server actions, validated with Zod
├── services/       Business logic and use cases
├── repositories/   Database access, scoped by userId
├── components/     UI components
└── lib/            Pure logic (recurrence, grades, spaced repetition, ICS parsing),
                    infrastructure (Prisma client, Ollama, vector store), config
prisma/             Schema and migrations
tests/unit/         Pure-logic tests
tests/integration/  Database-backed tests, including cross-account isolation
tests/e2e/          Playwright browser tests
tests/ai/evals.ts   AI evaluation and safety suite
```

---

## Getting started

### Prerequisites

- Node.js (a current LTS release) and pnpm 11 (pinned in `package.json`)
- Docker, to run PostgreSQL 17 with pgvector
- Ollama, with two models pulled

### Setup

```bash
pnpm install
cp .env.example .env
```

Open `.env` and set `NEXTAUTH_SECRET`. The comment in the file shows how to generate one. Then run:

```bash
pnpm db:up                     # starts PostgreSQL + pgvector in Docker
pnpm db:migrate                # applies the database migrations
ollama pull llama3.2:3b
ollama pull nomic-embed-text
ollama serve                   # in its own terminal, if it is not already running
pnpm dev                       # http://localhost:3100
```

Open http://localhost:3100, create an account, and start. The first account needs nothing; after it, `/register` asks for `REGISTRATION_CODE` from `.env` (and is closed when that is blank), which is how the browser tests add their own account.

The database credentials in `docker-compose.yml` and `.env.example` are for local development only. Do not reuse them anywhere else. `.env` is git-ignored and must stay that way.

### Environment variables

The server checks these at startup and refuses to start if any value is missing or invalid.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Session signing secret, at least 32 characters |
| `NEXTAUTH_URL` | Optional. The app's public URL |
| `OLLAMA_BASE_URL` | Where Ollama is listening, for example `http://127.0.0.1:11434` |
| `OLLAMA_CHAT_MODEL` | Chat model, for example `llama3.2:3b` |
| `OLLAMA_EMBEDDING_MODEL` | Embedding model, for example `nomic-embed-text` |

---

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server on port 3100 |
| `pnpm build` | Production build. Also generates the framework types that `tsc` needs |
| `pnpm start` | Runs the production build on port 3100 |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests for pure logic |
| `pnpm test:integration` | Database-backed tests, including cross-account isolation |
| `pnpm test:e2e` | Playwright browser tests against the dev server |
| `pnpm eval` | AI evaluation and safety suite (needs PostgreSQL and Ollama) |
| `pnpm db:up` / `pnpm db:down` | Start or stop PostgreSQL in Docker |
| `pnpm db:migrate` | Apply migrations in development |
| `pnpm db:studio` | Open Prisma Studio |

---

## Testing

- **Unit tests** cover pure logic: recurrence, grades, spaced repetition, ICS parsing, chunking and date handling.
- **Integration tests** run against a real PostgreSQL database and check that one account can never read or change another account's data.
- **End-to-end tests** drive the app in a browser. They create a temporary account and delete it afterwards.
- **The evaluation suite** checks retrieval quality, citation correctness, tenant isolation under a compromised answer, and tool-call validation. Some results describe how the model behaves rather than pass or fail, because a small local model's behaviour varies between phrasings. Those results are reported, not asserted.

Before merging, run:

```bash
pnpm build && pnpm lint && pnpm test && pnpm test:integration && pnpm eval
```

Run `pnpm build` even when the change is small. Some type errors only appear during the build.

---

## Continuous integration

GitHub Actions runs four jobs on every pull request and every push to `main`:

- **checks**: migrations, build, type check, lint, unit and integration tests.
- **e2e**: installs Ollama and the two models, then runs the Playwright suite.
- **evals**: runs the AI evaluation suite.
- **container**: builds the production image and rehearses a deploy, a backup, a failed release, a rollback and a restore against a throwaway stack.

The `main` branch requires all four jobs to pass before a pull request can be merged. The repository owner can bypass that rule in an emergency. Pull requests also get a dependency review that fails on a newly introduced runtime dependency with a known high-severity vulnerability, and Dependabot proposes updates weekly.

---

## Deployment

Merging to `main` publishes a container image. Moving it to production needs your approval in GitHub (the `production` environment). Your own machine then notices, backs up the database and attachments, applies migrations, starts the new version, runs a smoke check, and puts the previous version back if the check fails. GitHub never connects to the machine and holds no credential for it.

[`ops/README.md`](ops/README.md) is the runbook: setup, day-to-day commands, rollback, backups and restore, and what to do when something is wrong.

---

## Privacy and data

- All records are stored in your local PostgreSQL database. Attachments are stored as files in `data/attachments/`, not in the database.
- `/api/export` downloads your data as one JSON file, written a page at a time so a large account does not have to fit in memory. The file says what it leaves out (see [Limitations](#limitations)).
- `/api/calendar/<token>.ics` is your calendar feed. It is the one address that needs no sign-in, so the token in it is the credential: 256 random bits, shown once when you make the link, with only a hash of it kept. Anyone who has the address can read your event and task titles and times, so treat it like a password; "Make a new link" in Settings stops the old one at once, and "Turn off" ends it. Use the https address of your deployment (an `http://` one sends the token in the clear), and see `ops/README.md` for what that means for proxies and logs.
- `/api/export/vault` downloads your notes and their attachments as a zip of Markdown files (one per note, named by its title so `[[links]]` work in Obsidian), written one entry at a time. Importing a vault zip is under Notes → Import. Only notes and attachments are in it; the JSON export and the backup hold the rest.
- Registration closes once the first account exists. More accounts need the invite code in `REGISTRATION_CODE`; with none set, `/register` makes nothing.
- Passwords are hashed with scrypt. Login is throttled after five failed attempts per email in a 15-minute window.
- Calendar feeds are fetched by the server. Requests to private and loopback addresses are refused.
- Voice input uses the browser's built-in speech recognition. In Chrome, that recognition service runs on Google's servers, so the audio you speak can leave your machine.
- Phone reminders go through your own ntfy server; the text never leaves your machine. For an iPhone, ntfy.sh receives only a message id and a hash of the topic to wake the app.
- Writing-behaviour tracking and timer sessions are opt-in, off by default, and three separate switches. They store how long you write or ran the timer, how fast you type, and (only if you switch it on) which course; never the content, a note or task title, or what you worked on.

---

## Limitations

- **Self-hosted only.** Anamnesis is built for personal use on your own computer. The deployment pipeline serves that machine and binds the app to localhost; it is not ready to be exposed to the internet (no HTTPS, and only the login is rate limited). The backups it takes are on the same machine as the data.
- **The local chat model is the weakest part.** A 3B model handles multi-item requests and some phrasings inconsistently. Its behaviour is measured rather than guaranteed. The security boundary does not depend on it.
- **Quiz marking is a suggestion.** The small local model that marks answers rarely gives partial credit and can be talked into a wrong verdict by an answer that tells it to, which is why it only suggests and you choose the grade. Questions it writes from your notes are filtered for wording that is not in the note, but not for whether the answer fits the question, so some will not.
- **Reminders need the server running and, for the phone, ntfy and Tailscale.** While no tab is open, reminders come only through the self-hosted ntfy server (see `ops/README.md`); a Mac that is asleep sends nothing, and an event that has already started is never announced late. There is no offline mode.
- **The JSON export is a copy of your data, not a full backup.** It carries your notes and their versions, tasks and their checklist steps, projects, goals, courses and grades, flashcards, events, links, assistant conversations, attachment records and calendar feed names. It leaves out the attachment files (they are in the backup's `attachments.tar`), calendar feed addresses (they are secrets; only the host is kept), the search index, your password hash, and anything in the trash. It is not a snapshot: items changed while it runs can be missing or half-updated. There is no restore from the JSON file yet; restoring everything is done from a backup (see `ops/README.md`), and the vault zip restores notes and their attachments.
- **Sharing from an iPhone needs a Shortcut.** iPhone Safari cannot list a web app in its share sheet, so `ops/README.md` has a three-step Shortcut that opens the clip card with the link; Android and desktop Chrome offer the installed app directly. Either way the phone must reach the server, which the runbook does over Tailscale.
- **The web clipper reads what the page's HTML holds.** A page behind a sign-in, or one that builds its article in JavaScript, has little or nothing to clip; images stay links to the source. Pages over 5 MB, slower than 15 seconds, or nested unusually deep or large are refused, and nothing on this machine or its network is ever fetched.
- **Calendar import is one-way.** Feeds are read-only. Repeating series are capped at 52 occurrences; from one occurrence you can change this and the later ones (not the repeat pattern, and not their dates).
- **The hourly grid groups by the server's local days.** If the server's time zone is not your browser's (a container running in UTC, say), items near midnight can appear in the wrong column; set the container's `TZ` to yours. A touch screen does not drag: select a block and use the buttons above the grid.
- **Recorded study time is only what the app saw.** Time counts only while a switch is on and the page is open, and says nothing about the studying done elsewhere. Closing a tab right after a timer finishes can lose that last session.
- **Semantic search needs Ollama.** Without it, the notes page falls back to keyword matching, the `/search` page shows a message, and the assistant reports an error.

---

## Documentation

`CLAUDE.md` is the engineering specification and design record. It explains the decisions behind each feature, the trade-offs, and the measured results. Read it before changing anything substantial. `ops/README.md` is the operations runbook.

---

## License

No license has been chosen yet. Until one is added, all rights are reserved.

---

Built by Youssef Zuaiter, an AI Engineering student.
