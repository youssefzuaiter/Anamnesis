#!/usr/bin/env bash
# Rehearses the whole production routine against a throwaway copy of the stack.
#
#   ops/rehearse.sh [<image>]          # default image: anamnesis:local
#
# It runs the SAME scripts a real host runs, in this order, and fails loudly if
# any of them does not do what it promises:
#
#   first deploy -> signed-in smoke check -> backup -> verify the backup restores
#   -> second deploy (must back up first) -> a deploy that fails its smoke check
#   (must roll back and keep serving) -> simulated data loss -> restore -> smoke
#
# Nothing it touches is real: its own compose project, volumes, port, secrets,
# state and backups, all removed on the way out. CI runs it on every pull
# request; run it by hand before trusting a new image or a change to ops/.
#
# The backups it makes hold only synthetic rows, but they are deliberately never
# uploaded as CI artifacts: a real backup on a public repository must not be.
set -euo pipefail
OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_REF="${1:-anamnesis:local}"

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/anamnesis-rehearsal.XXXXXX")"
PORT="${ANAMNESIS_PORT:-3299}"
export ANAMNESIS_ENV_FILE="$SANDBOX/env"
export ANAMNESIS_STATE_DIR="$SANDBOX/state"
export ANAMNESIS_BACKUP_DIR="$SANDBOX/backups"
export COMPOSE_PROJECT_NAME="anamnesis-rehearsal-$$"
# CI has no Ollama. Set SMOKE_SKIP_OLLAMA=0 on a machine that does, to check the
# container-to-host path as well.
export SMOKE_SKIP_OLLAMA="${SMOKE_SKIP_OLLAMA:-1}"
skip_ollama=""
[ "$SMOKE_SKIP_OLLAMA" = 1 ] && skip_ollama="--skip-ollama"

# After the exports: lib.sh reads them.
# shellcheck source=ops/lib.sh
. "$OPS_DIR/lib.sh"

cleanup() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    log "rehearsal FAILED — app logs:"
    compose logs --no-color --tail 40 app >&2 2>/dev/null || true
  fi
  compose down -v >/dev/null 2>&1 || true
  rm -rf "$SANDBOX"
  exit "$code"
}
trap cleanup EXIT

step() { printf '\n==> %s\n' "$*" >&2; }
fail() { log "REHEARSAL FAILED: $*"; exit 1; }
expect() { # expect <what> <expected> <actual>
  [ "$2" = "$3" ] || fail "$1: expected '$2', got '$3'"
  log "  ok  $1: $3"
}

need docker
need node
need openssl
need age
docker image inspect "$IMAGE_REF" >/dev/null 2>&1 || fail "image $IMAGE_REF is not available locally (build it, or pull it, first)"

step "set up a throwaway environment"
"$OPS_DIR/bootstrap.sh" >/dev/null 2>&1
# A fixed port that is unlikely to collide, instead of the real one.
grep -v '^ANAMNESIS_PORT=' "$ANAMNESIS_ENV_FILE" >"$ANAMNESIS_ENV_FILE.tmp"
printf 'ANAMNESIS_PORT=%s\n' "$PORT" >>"$ANAMNESIS_ENV_FILE.tmp"
mv "$ANAMNESIS_ENV_FILE.tmp" "$ANAMNESIS_ENV_FILE"
chmod 600 "$ANAMNESIS_ENV_FILE"

step "first deploy"
"$OPS_DIR/deploy.sh" --ref "$IMAGE_REF" --no-pull

step "seed an account, notes and an attachment"
PASSWORD="rehearsal-only-$(openssl rand -hex 8)"
# The app's own format: scrypt$N$r$p$salt$key (see src/lib/password.ts).
HASH="$(node -e '
const { randomBytes, scryptSync } = require("node:crypto");
const salt = randomBytes(16);
const key = scryptSync(process.argv[1].normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1, maxmem: 128 * 16384 * 8 * 2 });
console.log(["scrypt", 16384, 8, 1, salt.toString("base64"), key.toString("base64")].join("$"));
' "$PASSWORD")"
compose exec -T postgres psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO "User" (id, email, name, "passwordHash", "updatedAt")
VALUES ('rehearsal-user', 'rehearsal@example.test', 'Rehearsal', '$HASH', now());
INSERT INTO "Note" (id, "userId", title, content, tags, "updatedAt")
VALUES ('n1', 'rehearsal-user', 'First note', 'must survive a restore', '{}', now()),
       ('n2', 'rehearsal-user', 'Second note', 'so must this', '{}', now());
SQL
compose exec -T app sh -c 'echo "attachment bytes" > /app/data/attachments/rehearsal.txt'

step "smoke check from the host, signed in, through the published port"
SMOKE_EMAIL=rehearsal@example.test SMOKE_PASSWORD="$PASSWORD" \
  node "$OPS_DIR/smoke.mjs" --url "http://127.0.0.1:$PORT" ${skip_ollama:+"$skip_ollama"}

step "take a backup, and prove it restores"
BACKUP="$("$OPS_DIR/backup.sh")"
[ -d "$BACKUP" ] || fail "backup.sh did not print a backup directory (got: $BACKUP)"
expect "backup.sh prints only the path" 1 "$(printf '%s\n' "$BACKUP" | wc -l | tr -d ' ')"
"$OPS_DIR/verify-backup.sh" "$BACKUP"

step "a bad backup must be rejected"
BAD="$ANAMNESIS_BACKUP_DIR/anamnesis-20000101T000000Z"
cp -R "$BACKUP" "$BAD"
printf 'damage' >>"$BAD/database.dump"
if "$OPS_DIR/verify-backup.sh" "$BAD" >/dev/null 2>&1; then fail "verify-backup.sh accepted a damaged backup"; fi
log "  ok  a damaged backup is refused"
rm -rf "$BAD"

step "an encrypted off-site copy: encrypt, copy, decrypt, restore"
# A throwaway key pair. The private key lives in the sandbox only for this test; on a real host it is never
# on the machine. Everything below is the real scripts.
OFFSITE_KEY="$SANDBOX/offsite-key.txt"
age-keygen -o "$OFFSITE_KEY" >/dev/null 2>&1
export ANAMNESIS_OFFSITE_RECIPIENT
ANAMNESIS_OFFSITE_RECIPIENT="$(grep -o 'age1[0-9a-z]*' "$OFFSITE_KEY" | head -n 1)"
export ANAMNESIS_OFFSITE_DIR="$SANDBOX/offsite"
mkdir "$ANAMNESIS_OFFSITE_DIR"
"$OPS_DIR/offsite.sh" >/dev/null
COPIES="$(find "$ANAMNESIS_OFFSITE_DIR" -maxdepth 1 -type f -name 'anamnesis-*.tar.age' | wc -l | tr -d ' ')"
expect "one encrypted copy for the one backup" 1 "$COPIES"
COPY="$(find "$ANAMNESIS_OFFSITE_DIR" -maxdepth 1 -type f -name 'anamnesis-*.tar.age')"
if grep -aq 'PGDMP' "$COPY" || grep -aq 'User ' "$COPY"; then fail "the encrypted copy holds readable data"; fi
log "  ok  the copy holds no readable data"
"$OPS_DIR/offsite.sh" --check
"$OPS_DIR/verify-offsite.sh" --identity "$OFFSITE_KEY"
OTHER_KEY="$SANDBOX/other-key.txt"
age-keygen -o "$OTHER_KEY" >/dev/null 2>&1
if "$OPS_DIR/decrypt-backup.sh" "$COPY" --identity "$OTHER_KEY" --out "$SANDBOX/wrong-key" >/dev/null 2>&1; then fail "a copy was decrypted with the wrong key"; fi
[ ! -e "$SANDBOX/wrong-key" ] || fail "a failed decrypt left a folder behind"
log "  ok  the wrong key is refused and leaves nothing"

step "second deploy: must take a backup before touching anything"
# Configure the smoke account the way a real host would, so this deploy runs the
# signed-in check too.
printf 'SMOKE_EMAIL=rehearsal@example.test\nSMOKE_PASSWORD=%s\n' "$PASSWORD" >>"$ANAMNESIS_ENV_FILE"
before="$(find "$ANAMNESIS_BACKUP_DIR" -maxdepth 1 -type d -name 'anamnesis-*' | wc -l | tr -d ' ')"
"$OPS_DIR/deploy.sh" --ref "$IMAGE_REF" --no-pull 2>&1 | tee "$SANDBOX/second-deploy.log"
grep -q "PASS  signing in as the smoke account works" "$SANDBOX/second-deploy.log" \
  || fail "the deploy did not run the signed-in smoke check although a smoke account was configured"
log "  ok  the deploy ran the signed-in smoke check"
after="$(find "$ANAMNESIS_BACKUP_DIR" -maxdepth 1 -type d -name 'anamnesis-*' | wc -l | tr -d ' ')"
[ "$after" -gt "$before" ] || fail "a deploy over a live database did not take a backup first"
log "  ok  backups went from $before to $after"
# backup.sh made that backup with an off-site copy configured, so the copy must have followed it.
copies_after="$(find "$ANAMNESIS_OFFSITE_DIR" -maxdepth 1 -type f -name 'anamnesis-*.tar.age' | wc -l | tr -d ' ')"
expect "every backup has an encrypted copy" "$after" "$copies_after"
# The weekly verify (no argument) also insists that copies keep arriving: it passes now, and fails when the
# folder is empty (a drive that stopped receiving copies).
"$OPS_DIR/verify-backup.sh" >/dev/null 2>&1 || fail "the weekly verify failed although off-site copies are arriving"
log "  ok  the weekly verify passes while copies arrive"
EMPTY="$SANDBOX/offsite-empty"
mkdir "$EMPTY"
if ANAMNESIS_OFFSITE_DIR="$EMPTY" "$OPS_DIR/verify-backup.sh" >/dev/null 2>&1; then fail "the weekly verify passed with no off-site copies"; fi
log "  ok  the weekly verify fails when copies stop arriving"

step "the watcher sees the running app, and an alert reaches the phone server"
# One pass against the real app (deep health), the real backup folder and the real off-site folder. The
# sandbox was set up by bootstrap.sh, so it has ntfy and an alert topic: an alert sent now must go through
# the stack's own ntfy, which is the delivery path the owner's phone uses. (No topic is covered in
# tests/unit/watch.test.ts, where it is the only case under test.)
node "$OPS_DIR/watch.mjs" >/dev/null 2>&1 || fail "the watcher's pass failed"
[ -f "$ANAMNESIS_STATE_DIR/watch.json" ] || fail "the watcher did not save its state"
app_failures="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(s.app.failures)' "$ANAMNESIS_STATE_DIR/watch.json")"
expect "the watcher finds the app answering" 0 "$app_failures"
backup_failures="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(s.backup.failures)' "$ANAMNESIS_STATE_DIR/watch.json")"
expect "the watcher finds a recent backup" 0 "$backup_failures"
node "$OPS_DIR/watch.mjs" --notify "Anamnesis: rehearsal" "the alert path works" 2>"$SANDBOX/notify.err" \
  || fail "an alert must not fail its caller"
grep -q "alert sent: Anamnesis: rehearsal" "$ANAMNESIS_STATE_DIR/watch.log" \
  || fail "the alert was not delivered to the phone server ($(cat "$SANDBOX/notify.err"))"
log "  ok  an alert is delivered through the stack's ntfy"
log "  ok  an alert in the stack is delivered through its own ntfy server"

step "a release that fails its smoke check must roll back and keep serving"
if ANAMNESIS_EXPECT_VERSION=not-the-running-release \
   "$OPS_DIR/deploy.sh" --ref "$IMAGE_REF" --no-pull >"$SANDBOX/rollback.log" 2>&1; then
  fail "a deploy that fails its smoke check exited 0"
fi
curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/health" >/dev/null \
  || fail "the app is not serving after the rollback"
[ -s "$ANAMNESIS_STATE_DIR/failed-digest" ] || fail "the failed release was not remembered"
log "  ok  exit non-zero, previous release serving, failure remembered"

step "simulate data loss, then restore"
compose exec -T postgres psql -U "$PGUSER" -d "$PGDB" -q -c 'DELETE FROM "Note"'
compose exec -T app rm -f /app/data/attachments/rehearsal.txt
expect "notes after the simulated loss" 0 "$(psql_query 'SELECT count(*) FROM "Note"')"

if "$OPS_DIR/restore.sh" "$BACKUP" >/dev/null 2>&1; then fail "restore.sh ran without --confirm-overwrite"; fi
log "  ok  restore refuses without --confirm-overwrite"

"$OPS_DIR/restore.sh" "$BACKUP" --confirm-overwrite
expect "notes after the restore" 2 "$(psql_query 'SELECT count(*) FROM "Note"')"
expect "attachment after the restore" "attachment bytes" "$(compose exec -T app cat /app/data/attachments/rehearsal.txt | tr -d '\r\n')"

step "smoke check again, signed in"
SMOKE_EMAIL=rehearsal@example.test SMOKE_PASSWORD="$PASSWORD" \
  node "$OPS_DIR/smoke.mjs" --url "http://127.0.0.1:$PORT" ${skip_ollama:+"$skip_ollama"}

printf '\nREHEARSAL PASSED\n' >&2
