# Operations runbook

How Anamnesis gets from a merged pull request to running on your machine, how it is backed up, and what to do when something goes wrong. The *reasons* for these choices are recorded in `CLAUDE.md` under "Operations"; this file is the how-to.

## The shape of it

```
 you merge a PR into main
        │
        ▼
 GitHub: "Publish and promote" builds the image  ──►  ghcr.io/<repo>:<commit>
        │
        ▼   the job PAUSES: GitHub asks you to approve the "production" deployment
        │
        ▼   you approve
 GitHub moves the tag  ghcr.io/<repo>:production  onto that image
        │
        ▼   (within ~5 minutes)
 your machine: ops/update.sh notices the tag moved
        │      1. back up the database and the attachments
        │      2. apply database migrations
        │      3. start the new app
        │      4. smoke check; if it fails, put the previous app back
        ▼
 running
```

GitHub never connects to your machine and holds no credential for it. Your machine pulls. That is deliberate: this repository is public, so a self-hosted runner or an SSH key in GitHub would be an open door.

## One-time setup on the production machine

You need Docker, git, Node 20 or newer (used for pruning old backups), and Ollama with the two models pulled (`ollama pull llama3.2:3b && ollama pull nomic-embed-text`). Ollama runs on the machine itself, not in a container, because Docker cannot give a container the Mac's GPU.

```bash
git clone https://github.com/youssefzuaiter/Anamnesis.git ~/anamnesis && cd ~/anamnesis
ops/bootstrap.sh          # writes .env.production with generated secrets, creates the backup directory
```

Then, in GitHub, approve the first production deployment (Actions → "Publish and promote" → the waiting run → Review deployments → `production` → Approve). When it has finished:

```bash
ops/update.sh --force     # deploys it
open http://localhost:3200/register    # create your account
```

Optional but recommended:

```bash
ops/install-launchd.sh    # checks for a new release every 5 minutes, backs up nightly, verifies weekly
```

For a smoke check that really signs in, register a second, otherwise empty account, give it a long random password, and add `SMOKE_EMAIL=` and `SMOKE_PASSWORD=` to `.env.production`. Every deploy then proves that sessions and the database work together.

The app listens on `127.0.0.1:3200` only. Anything that is not this machine cannot reach it, which is the point; read "Before exposing it" below before changing that.

## Day to day

| I want to… | Do this |
| --- | --- |
| Ship a change | Merge the PR. Approve the production deployment in GitHub when you are ready. |
| Deploy right now | `ops/update.sh` (add `--force` to retry a release that failed before) |
| See what happened | `ops/state/update.log`, `ops/state/backup.log`, `ops/state/verify.log` |
| See what is running | `curl -s http://127.0.0.1:3200/api/health?deep=1` (shows the commit, migration count, pgvector, Ollama) |
| Check the system by hand | `node ops/smoke.mjs --url http://127.0.0.1:3200` |
| Look at the app's logs | `docker compose --env-file .env.production -f compose.prod.yml logs -f app` |
| Practise everything safely | `ops/rehearse.sh <image>` runs deploy, backup, restore, rollback and disaster recovery against a throwaway copy |

## Rolling back

Rolling back **restores the previous code, never the database.** Migrations go forward only. That is why the rule below exists.

- **A bad release that failed its smoke check:** nothing to do. The previous release was put back automatically and the failed one is remembered, so it is not retried every five minutes. Fix it and merge a new one.
- **A bad release that passed its smoke check:** in GitHub, run "Publish and promote" by hand with an earlier commit's full sha. The host picks it up like any other release.
- **Straight from the machine:** `ops/deploy.sh --ref ghcr.io/youssefzuaiter/anamnesis:<full commit sha>`

### The migration rule

A migration must leave the **previous** release working. Otherwise a rollback puts code back that cannot run against the new schema. In practice:

- Add columns and tables freely (nullable, or with a default).
- Never drop or rename something in the same release that stops using it. Release one stops using it; a later release removes it.
- If a migration cannot satisfy this, say so in the PR and plan the deploy by hand: take a backup, deploy, and keep the backup path ready.

## Backups

`ops/backup.sh` runs nightly at 03:15 if you installed the launchd jobs, and always immediately before a deploy.

- **Written to** `~/anamnesis-backups/anamnesis-<UTC timestamp>/`, outside the repository, owner-only.
- **Contains** `database.dump` (a full Postgres dump), `attachments.tar` (the uploaded files, which live on disk and not in the database), `counts.txt` (row counts at that moment), `manifest.json` and `SHA256SUMS`.
- **Kept**: everything from the last 7 days, the newest of each of the last 4 weeks, the newest of each of the last 6 months, and always at least the 3 newest.
- **Checked** every Sunday at 04:30 by `ops/verify-backup.sh`, which restores the newest backup into a throwaway database and compares row counts with what was recorded. A backup that has never been restored is a hope, not a backup.

**They are on the same machine as the data.** That protects against a bad deploy or a deleted row, not against the disk dying. Until you copy them somewhere else, you have no protection against that. When you do, encrypt them first, and never put a backup in a GitHub artifact or any public place: this repository is public, so artifacts are downloadable by anyone.

### Restoring

```bash
ops/verify-backup.sh ~/anamnesis-backups/anamnesis-<timestamp>        # first: is it good? touches nothing
ops/restore.sh ~/anamnesis-backups/anamnesis-<timestamp> --confirm-overwrite
```

`restore.sh` refuses without the flag, takes a backup of the current state first (so restoring the wrong one is undoable), stops the app, replaces the database and the attachments, starts the app, and runs the smoke check.

## When something is wrong

| Symptom | Likely cause and fix |
| --- | --- |
| `docker pull` says denied or not found | The image package is private. In GitHub: your profile → Packages → `anamnesis` → Package settings → Change visibility → Public. Once. |
| Updater log says "registry not reachable or no production release yet" | Nothing has been promoted yet, or there is no network. It tries again in 5 minutes. |
| Updater says a release "already failed here" | It failed its smoke check and is being skipped on purpose. Merge a fix, or `ops/update.sh --force` to retry. |
| Deploy stops at "migrations failed" | The previous release is still serving. A backup was taken first (its path is in the output). Read the migration error; restore only if the database was left in a bad state. |
| Smoke check: "Ollama is reachable" fails | Start Ollama on the host: `ollama serve`. The app itself keeps working without it; search falls back to keywords. |
| Smoke check: "both models … are installed" fails | `ollama pull llama3.2:3b && ollama pull nomic-embed-text` |
| Port 3200 is taken | Set `ANAMNESIS_PORT` in `.env.production` and run `ops/update.sh --force`. |
| launchd jobs do nothing | Check the `.log` files in `ops/state/`. The jobs run while you are logged in. |

## Before exposing it to the internet

It is bound to localhost on purpose. Before it is reachable from anywhere else:

1. Put a reverse proxy with HTTPS in front of it (Caddy is the least work).
2. Set `NEXTAUTH_URL` to the public address.
3. **Close open registration.** Today anyone who can reach `/register` can create an account. That is fine on localhost and not fine on the internet.
4. Add rate limiting beyond the login throttle, and security headers.

The code is public, so assume anyone reading it knows exactly how it works.

## Dependencies

Dependabot proposes updates weekly (grouped, so each pull request runs the full suite once, not once per package) and raises security fixes as they are published. The "Dependency review" check fails a pull request that introduces a dependency with a known high-severity vulnerability. The dependency graph itself is under Insights → Dependency graph on GitHub.
