#!/usr/bin/env bash
# Shared by the ops scripts: source it, never run it.
#
# Written for bash 3.2, the one macOS ships, so: no associative arrays, no
# mapfile, no ${var,,}, and no expanding a possibly-empty array under `set -u`.

# shellcheck disable=SC2034,SC2317  # variables are consumed by the scripts that source this file; the exit is the fallback when `return` is not allowed
# The repo root is found through BASH_SOURCE, which only bash sets. Sourced into
# zsh or sh this file would quietly resolve the wrong directory and then fail
# somewhere confusing, so refuse up front.
if [ -z "${BASH_VERSION:-}" ]; then
  echo "ops/lib.sh must be sourced from bash; run the ops scripts directly (they start bash themselves)" >&2
  return 1 2>/dev/null || exit 1
fi

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$OPS_DIR/.." && pwd)"

ENV_FILE="${ANAMNESIS_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="${ANAMNESIS_COMPOSE_FILE:-$ROOT/compose.prod.yml}"
STATE_DIR="${ANAMNESIS_STATE_DIR:-$ROOT/ops/state}"
BACKUP_DIR="${ANAMNESIS_BACKUP_DIR:-$HOME/anamnesis-backups}"
IMAGE="${ANAMNESIS_IMAGE:-ghcr.io/youssefzuaiter/anamnesis}"

# The compose project name decides the volume names, so it is fixed here rather
# than guessed: backups need to find <project>_attachments by name. A different
# COMPOSE_PROJECT_NAME is how the tests run a throwaway copy beside the real one.
PROJECT="${COMPOSE_PROJECT_NAME:-anamnesis-prod}"
export COMPOSE_PROJECT_NAME="$PROJECT"
ATTACH_VOLUME="${PROJECT}_attachments"

PGUSER=anamnesis
PGDB=anamnesis

# Any image with tar and the Postgres client tools in it. The compose stack
# already pulled this one, so using it costs no extra download.
HELPER_IMAGE="pgvector/pgvector:pg17"

# Tables whose row counts are recorded in every backup and compared after a
# restore. Not exhaustive on purpose: enough to prove the data came back.
COUNTED_TABLES="User Note Task Project Goal Event Course Flashcard Attachment WorkspaceEmbedding"

# `docker compose up` cannot even read the compose file without knowing which image
# to run. deploy.sh sets this explicitly for a release it is rolling out; every
# other script (restore, manual `compose` commands) means "what is deployed now".
if [ -z "${ANAMNESIS_REF:-}" ] && [ -f "$STATE_DIR/current-ref" ]; then
  ANAMNESIS_REF="$(cat "$STATE_DIR/current-ref")"
  export ANAMNESIS_REF
fi

# Logs go to stderr so that stdout stays free for a script's actual output (the
# backup script prints the path it wrote, for callers to capture).
log() { printf '%s  %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but was not found in PATH"; }

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

require_env_file() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE does not exist — run ops/bootstrap.sh first"
}

# Reads one value from the env file without sourcing it, so nothing in the file
# is ever executed.
env_value() {
  local name="$1" fallback="${2:-}" value
  value="$(grep -E "^${name}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2-)"
  printf '%s' "${value:-$fallback}"
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

# psql through the running database container. Quiet, unaligned, no headers.
psql_query() {
  compose exec -T postgres psql -U "$PGUSER" -d "$PGDB" -At -c "$1" | tr -d '[:space:]'
}

# --- locking: one deploy or update at a time -------------------------------

lock_dir() { printf '%s/lock' "$STATE_DIR"; }

# True if another live process holds the lock. A lock left behind by a process
# that died (power cut, kill -9) is detected by its pid and cleared.
lock_held_by_other() {
  local dir pid
  dir="$(lock_dir)"
  [ -d "$dir" ] || return 1
  pid="$(cat "$dir/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && [ "$pid" != "$$" ]; then return 0; fi
  rm -rf "$dir"
  return 1
}

lock_acquire() {
  mkdir -p "$STATE_DIR"
  if lock_held_by_other; then die "another deploy or update is already running"; fi
  mkdir "$(lock_dir)" 2>/dev/null || die "could not take the lock at $(lock_dir)"
  printf '%s' "$$" >"$(lock_dir)/pid"
  trap 'rm -rf "$(lock_dir)"' EXIT
}
