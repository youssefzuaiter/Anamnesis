# Anamnesis

A private, self-hosted workspace for your notes, tasks, calendar, projects, goals, courses and flashcards. It includes an AI assistant that answers questions from your own writing and shows where each answer came from.

Everything runs on your own machine. Your records stay in your own PostgreSQL database, and the AI models run locally through Ollama, so no paid AI API or cloud AI service is involved.

> **Status:** a working personal project. It is not deployed publicly. See [Limitations](#limitations).

---

## What it is

Anamnesis brings together parts of academic and personal life that usually sit in separate tools:

- **Notes** in Markdown, with version history and restore, `[[wiki links]]` with backlinks, a graph view, tags, favourites, attachments, and import from PDF files and Markdown files (including Obsidian exports).
- **Tasks** with due dates, priorities, tags, repeating schedules, and time blocks you can drag onto the calendar.
- **Calendar** with month, week and day views, repeating events, and read-only import of `.ics` feeds such as university timetables.
- **Projects and goals.** A project's progress is calculated from its tasks. A goal's progress is calculated from its own tasks and from the projects linked to it.
- **Courses** with assessments, a grade calculator that shows what you need on the remaining work, and an exam-prep summary.
- **Flashcards and review.** Spaced repetition using the SM-2 algorithm. Cards can be generated from a note.
- **Search.** Semantic search finds content by meaning. The command palette (Ctrl+K or ⌘K) does quick literal search and navigation.
- **Assistant.** Ask questions about your workspace and get cited answers. It can also propose new tasks, events, notes or goals. Nothing is created until you confirm.
- **Audit log and trash.** Every assistant proposal and your decision is recorded. Deleted notes, tasks, projects and goals go to a trash, where you can restore them or delete them permanently.
- **Dashboard.** Today's tasks and schedule, recent notes, active projects and goals, and a "Plan my day" button. It proposes a plan that fits open tasks into your free time and changes nothing until you confirm.

Each account on an instance is separate from the others. Data access is scoped to the signed-in user, and tests check that one account cannot see another's data.

---

## Goal of the project

Anamnesis has four aims.

1. **One place for connected work.** Notes, tasks, events, projects, goals and courses are linked, so you can move from one to another.
2. **An assistant you can check.** Answers come from your own content and cite it. The assistant can only propose new items, never edit or delete them, and every proposal is logged.
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
| Database | PostgreSQL 17 with pgvector (HNSW index for vector search) |
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

Open http://localhost:3100, create an account, and start.

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
- `/api/export` downloads your data as JSON. The export is not complete yet (see [Limitations](#limitations)).
- Passwords are hashed with scrypt. Login is throttled after five failed attempts per email in a 15-minute window.
- Calendar feeds are fetched by the server. Requests to private and loopback addresses are refused.
- Voice input uses the browser's built-in speech recognition. In Chrome, that recognition service runs on Google's servers, so the audio you speak can leave your machine.
- Writing-behaviour tracking is opt-in and off by default. It stores how long you write and how many characters you type, never the content.

---

## Limitations

- **Self-hosted only.** Anamnesis is built for personal use on your own computer. The deployment pipeline serves that machine and binds the app to localhost; it is not ready to be exposed to the internet (open registration, no HTTPS). The backups it takes are on the same machine as the data.
- **The local chat model is the weakest part.** A 3B model handles multi-item requests and some phrasings inconsistently. Its behaviour is measured rather than guaranteed. The security boundary does not depend on it.
- **Reminders appear only while the dashboard is open.** There are no push notifications and no offline mode. The app can be installed as a web app, but the server must be running.
- **Export is incomplete.** It leaves out courses and assessments, flashcards, note versions, assistant conversations, attachments and calendar subscriptions. There is no import yet.
- **Calendar import is one-way.** Feeds are read-only. Repeating series are capped at 52 occurrences and cannot be edited as a series.
- **Semantic search needs Ollama.** Without it, the notes page falls back to keyword matching, the `/search` page shows a message, and the assistant reports an error.

---

## Documentation

`CLAUDE.md` is the engineering specification and design record. It explains the decisions behind each feature, the trade-offs, and the measured results. Read it before changing anything substantial. `ops/README.md` is the operations runbook.

---

## License

No license has been chosen yet. Until one is added, all rights are reserved.

---

Built by Youssef Zuaiter, an AI Engineering student.
