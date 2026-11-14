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
open http://localhost:3200/register    # create your account (the first one needs no code)
```

Optional but recommended:

```bash
ops/install-launchd.sh    # checks for a new release every 5 minutes, backs up nightly, verifies weekly
```

For a smoke check that really signs in, register a second, otherwise empty account. After the first account `/register` is closed, so for this one step put `REGISTRATION_CODE=` (16 or more random characters, for example `openssl rand -hex 16`) in `.env.production`, run `ops/deploy.sh`, register with that code, then remove the line and run `ops/deploy.sh` again. Give the account a long random password, and add `SMOKE_EMAIL=` and `SMOKE_PASSWORD=` to `.env.production`. Every deploy then proves that sessions and the database work together. **Never turn two-factor sign-in on for that account**: the smoke check signs in with the password alone, so it would fail every deploy.

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
- **Checked** every Sunday at 04:30 by `ops/verify-backup.sh`, which restores the newest backup into a throwaway database and compares row counts with what was recorded (and, if off-machine copies are set up, that they are still arriving). A backup that has never been restored is a hope, not a backup.

**They are on the same machine as the data.** That protects against a bad deploy or a deleted row, not against the disk dying or the machine being lost. Until you set up an off-machine copy (below), you have no protection against that. Never put a backup in a GitHub artifact or any public place: this repository is public, so artifacts are downloadable by anyone.

### Off-machine backups (encrypted, free)

After every backup, `ops/offsite.sh` encrypts a copy with [age](https://age-encryption.org) and puts it in a folder you choose: an external drive, a NAS mount, or a folder that something else (iCloud Drive, Syncthing, a free cloud tier) copies on. **The folder only ever holds ciphertext**, so a lost drive or a synced folder leaks nothing. Nothing is uploaded by this code; the destination is a path. **It costs nothing**: a drive or any folder is free. Cloud storage is the part that can cost money, and it is not built in; which service to sync the encrypted folder to, free tier or paid, is your call.

**Key custody is the whole design.** Backups are encrypted to a *public* key kept in `.env.production`. The matching *private* key is what opens them, and it must **not** live on this Mac (then a stolen Mac would open its own copies) and must **not** live only here either (then a dead Mac would take the key with the backups). Keep it in your password manager, plus a printed copy somewhere safe. **If you lose the private key, every encrypted copy is unreadable, and no one can help.**

One-time setup, on any machine you trust (it does not have to be the production Mac):

```bash
brew install age
age-keygen -o anamnesis-backup-key.txt     # prints "Public key: age1..." ; the file is the PRIVATE key
```

Put the file in your password manager (and print it), then **delete the file from this Mac**. In `.env.production` on the production Mac add only the public key and the folder:

```bash
OFFSITE_DIR=/Volumes/Backup/anamnesis
OFFSITE_RECIPIENT=age1...                  # the "Public key" line; never the AGE-SECRET-KEY one
```

Then take a backup (`ops/backup.sh`) and, **before relying on it**, prove a copy opens and restores, with the private key file in hand:

```bash
ops/verify-offsite.sh --identity ~/path/to/anamnesis-backup-key.txt     # decrypts the newest copy and restores it into a scratch database
```

- **When it runs.** Every `ops/backup.sh` (nightly, and before each deploy) copies any backup that has no copy yet, then prunes old copies with the same keep rules as the local ones. A copy is written as `.incomplete-...` and renamed when finished, so a pulled drive never leaves a half file that looks real.
- **Drive not plugged in.** The nightly backup still succeeds and logs a warning (`offsite.sh` exits 3); the missed copies are made the next time the drive is there. **If copies stop arriving the weekly verify (Sundays 04:30) fails**: it runs `ops/offsite.sh --check`, which wants a copy no older than 3 days (`OFFSITE_MAX_AGE_DAYS`). It only reaches the log files, so look at `ops/state/verify.log`, or use alerts when item 29 lands.
- **Restoring from a copy** (needs the private key):

```bash
ops/decrypt-backup.sh /Volumes/Backup/anamnesis/anamnesis-<timestamp>.tar.age --identity ~/path/to/key.txt
# prints the backup folder it made; then, as for any backup:
ops/verify-backup.sh <that folder>
ops/restore.sh <that folder> --confirm-overwrite
```

- **What encryption does not give you.** age hides the content; it does not prove who wrote a file. Anyone who can write to the drive can add a file that encrypts to your public key. `decrypt-backup.sh` therefore refuses anything but plain files inside one folder named for the copy (no `..`, links, absolute paths), and checks the files against their own checksums, but it cannot know a copy is the one *you* made: restore from a copy whose date and size you recognise.
- **Do not turn it on for the throwaway rehearsal's sake**: `ops/rehearse.sh` makes its own key pair and folder.

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

## The calendar feed is deliberately public

`GET /api/calendar/<token>.ics` is the one route that is **not** behind the session: a phone calendar cannot sign in, so the
token in the address is the credential (ROADMAP item 13). Three things follow for whoever runs this:

- **Do not put an authentication proxy, a path allow-list or a firewall rule in front of `/api/calendar/`** unless every
  subscribed calendar should stop working. An unknown, malformed or turned-off address is a plain 404 and nothing else is learned.
- **The address is a secret, and an access log records it.** `next dev` prints every request path, and a reverse proxy's access log
  will too. Do not ship those logs somewhere that people who must not read a person's timetable can read them; the cure after a
  leak is Settings, Calendar feed, Make a new link (the old address stops at once).
- **Serve it over https.** An `http://` address sends the token in the clear. The Settings card says so, and warns when the address
  is `localhost`, which a phone cannot reach.

Only a SHA-256 of the token is in the database (and so in a backup), so a stolen dump cannot rebuild an address. The migration
that added the two columns is additive and nullable, so the rule under "The migration rule" holds.

## Phone reminders

While no Anamnesis tab is open, reminders reach the phone through a self-hosted [ntfy](https://ntfy.sh)
server that runs beside the app (the `ntfy` service in `compose.prod.yml`). What fires them is a timer
inside the app itself, started when the server starts; it ticks once a minute and sends each reminder
once, however often the app restarts. Nothing is sent until someone turns it on in Settings.

**What it costs and what leaves the machine.** Nothing to pay. The reminder text stays on this Mac. The
iPhone app is woken through ntfy.sh, which receives only a message id and a hash of the topic, never the
text; that is how iOS delivers notifications instantly for a self-hosted server.

**Set it up once** (on the production Mac; `ops/bootstrap.sh` runs the first step for a new install):

```bash
ops/ntfy-setup.sh            # token, ntfy accounts, the phone's password and TZ into .env.production
ops/update.sh --force        # redeploys with ntfy beside the app
```

Then make it reachable from the phone, but only from your own devices, with Tailscale (free):

1. Install Tailscale on the Mac and the iPhone and sign in to the same account. In the Tailscale admin
   console, under DNS, enable MagicDNS and HTTPS certificates.
2. On the Mac: `tailscale serve --bg --https=443 http://127.0.0.1:2586` (check the flags with
   `tailscale serve --help` if your version differs). ntfy stays bound to localhost; Tailscale serves it
   over HTTPS to the tailnet only, never to the internet.
3. Put the address it prints (`https://<this-mac>.<tailnet>.ts.net`) in `.env.production` as
   `NTFY_PUBLIC_URL`, then `ops/update.sh --force`.
4. In the ntfy app on the iPhone: Settings, add the server `NTFY_PUBLIC_URL`, user `phone`, password
   `NTFY_PHONE_PASSWORD` from `.env.production`. Then subscribe to the topic shown under Settings, Reminders
   on your phone, on that server.
5. In Anamnesis, Settings, turn on **Send reminders to my phone** and press **Send a test**.

**Access control.** ntfy refuses everyone by default. The app may only publish, and only to `anamnesis-*`
topics; the `phone` account may only read them. The hashes in `.env.production` are single-quoted because
they contain `$`.

**When reminders do not arrive.** `curl -s 'http://127.0.0.1:3200/api/health?deep=1'` shows
`reminders.configured` and how many seconds ago the scheduler last ran; Settings shows the last error, if a
send failed (it is tried three times). `docker compose ... logs ntfy` shows what ntfy received. A Mac that
is asleep sends nothing; on waking it sends that day's list of what is due, but never a heads-up for an
event that has already started.

## Sharing a page from the iPhone

Anamnesis has a share address, `/share?url=<link>`: it opens the clip card with the link filled in (through
sign-in first if needed); nothing is fetched until **Clip page** is tapped. Android and desktop Chrome list
the installed app in their share sheet on their own (the manifest's `share_target`). **iPhone Safari does not
support share targets** (WebKit bug 194593), so on the iPhone a Shortcut does it. Set up once, after the
Tailscale steps above:

1. On the Mac, serve the app to the tailnet on its own port beside ntfy:
   `tailscale serve --bg --https=8443 http://127.0.0.1:3200`. The app stays bound to localhost; only your own
   devices on the tailnet reach `https://<this-mac>.<tailnet>.ts.net:8443`. Open that address in Safari on the
   iPhone once and sign in.
2. In the Shortcuts app: **New Shortcut**, then in its details turn on **Show in Share Sheet** and accept
   **URLs** (and **Safari web pages**). Add **URL Encode** (input: Shortcut Input), then **URL** with
   `https://<this-mac>.<tailnet>.ts.net:8443/share?url=` followed by the URL Encode result, then **Open URLs**.
   Name it "Clip to Anamnesis".
3. In Safari (or any app), Share, **Clip to Anamnesis**: the clip card opens with the link; tap **Clip page**.

**Not yet checked on a real iPhone or over Tailscale** (to do with the production step of item 19): that the
session survives on the `:8443` address and that Auth.js accepts the forwarded host.

## Alerts

The phone gets a message when something needs you, and one when it is fixed again. It goes through the same ntfy server as reminders (ROADMAP item 29), to its own topic, `ALERT_TOPIC`, which `ops/ntfy-setup.sh` makes. **Nothing is sent unless phone reminders are set up**, because the ntfy server is what delivers it.

What is watched, and what counts as wrong:

| Message | When |
| --- | --- |
| the app is not answering | its health check fails (database, pgvector, migrations) or nothing answers |
| reminders have stopped | reminders are on and the scheduler has not run for five minutes |
| the phone server (ntfy) is not answering | its own health check fails |
| no backup has been made / no recent backup | no backup folder, or the newest is more than 26 hours old |
| off-site copies are not arriving | off-site copies are set up and the newest is older than three days |
| the backup failed / the weekly backup check failed / an off-site copy failed | the job itself exits with an error (the message comes at once) |

- **It takes two bad checks in a row** (ten minutes) before the phone is told, so a restart does not wake you. It is told once; the same problem does not repeat until it recovers, and then the recovery is announced once.
- **It runs every five minutes**, from `ops/launchd/com.anamnesis.watch.plist.template`, installed by `ops/install-launchd.sh` with the other jobs. Its own record is `ops/state/watch.log`, and its state is `ops/state/watch.json`, which holds only counts and flags.
- **The phone must subscribe to the alert topic too.** In the ntfy app, add a subscription to `ALERT_TOPIC` on the same server as the reminders; the phone can read it and the app can only write to it.
- **What it cannot do.** If the Mac is off or asleep, nothing runs, and nothing can tell you so. An outside monitor would watch from somewhere else, but that means publishing the app's address to a third party; it is not built. Alerts reach you only as often as the phone is online for ntfy.
- **Try it.** `ops/watch.mjs --notify "test" "a test alert"` sends one message now and prints why if it did not.

## Signed-in devices

Settings lists each signed-in browser and can end it. The sign-in cookie is still a token, but it names a row in the `AuthSession` table and is refused the moment that row is gone (one indexed read per request, about 0.4 ms). **The deploy that first contains this signs everyone out once**: tokens made before it carry no session id, so each browser (the owner's phone and laptop) lands on the sign-in page once. Every smoke check signs in and so adds a row for the smoke account; an account keeps its newest 50 and drops rows idle for 30 days, so nothing builds up. The table is not in the data export, and a restore from a backup brings the old rows back with the data, so sessions that were ended after that backup was taken work again until they are ended once more.

## Before exposing it to the internet

It is bound to localhost on purpose. Before it is reachable from anywhere else:

1. Put a reverse proxy with HTTPS in front of it (Caddy is the least work).
2. Set `NEXTAUTH_URL` to the public address.
3. **Register the first account before it is reachable.** Registration closes once one account exists, and reopens only with `REGISTRATION_CODE` set; keep that unset. Until the first account exists, whoever reaches `/register` first gets it.
4. Add rate limiting beyond the login throttle, and security headers.

The code is public, so assume anyone reading it knows exactly how it works.

## Dependencies

Dependabot proposes updates weekly (grouped, so each pull request runs the full suite once, not once per package) and raises security fixes as they are published. The "Dependency review" check fails a pull request that introduces a dependency with a known high-severity vulnerability. The dependency graph itself is under Insights → Dependency graph on GitHub.
