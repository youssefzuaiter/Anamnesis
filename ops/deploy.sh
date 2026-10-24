#!/usr/bin/env bash
# Deploys one release to this machine.
#
#   ops/deploy.sh [--ref <image>] [--no-pull]
#
# Order is the point: back up, migrate, swap the app, smoke-check, and roll the
# app back if the smoke check fails. Normally ops/update.sh calls this when the
# `production` tag moves; run it by hand to (re)deploy a specific image:
#
#   ops/deploy.sh --ref ghcr.io/youssefzuaiter/anamnesis:<commit>
#
# Rolling back restores the previous CODE only. Migrations go forward and are
# never undone automatically, which is why every migration has to keep the
# previous release working (see ops/README.md). If a migration itself went
# wrong, the backup taken at the start of this script is the way back:
# ops/restore.sh <that backup> --confirm-overwrite.
#
# Environment: SMOKE_SKIP_OLLAMA=1 skips the Ollama checks (CI has no Ollama);
# ANAMNESIS_EXPECT_VERSION overrides which release the smoke check expects.
set -euo pipefail
# shellcheck source=ops/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REF="$IMAGE:production"
PULL=1
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="${2:?--ref needs an image}"; shift 2 ;;
    --no-pull) PULL=0; shift ;;
    *) die "unknown option: $1" ;;
  esac
done

need docker
require_env_file
lock_acquire
mkdir -p "$STATE_DIR"

PORT="$(env_value ANAMNESIS_PORT 3200)"
previous_ref="$(cat "$STATE_DIR/current-ref" 2>/dev/null || true)"

if [ "$PULL" = 1 ]; then
  log "pulling $REF"
  docker pull "$REF" >/dev/null
fi

# Pin to the immutable digest when there is one, so "what is deployed" can never
# drift because a tag moved underneath it. A locally built image has none, and is
# referred to by the name it was given.
deploy_ref="$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$REF")"
[ -n "$deploy_ref" ] || deploy_ref="$REF"
digest="${deploy_ref##*@}"

release="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$deploy_ref")"
expected="${ANAMNESIS_EXPECT_VERSION:-$release}"
log "release ${release:-unknown} ($deploy_ref)"

fail() {
  log "DEPLOY FAILED: $1"
  # Remembered so the updater does not retry the same broken release every
  # five minutes; a newer release, or --force on update.sh, clears it.
  printf '%s' "$digest" >"$STATE_DIR/failed-digest"
  exit 1
}

if compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  log "backing up before touching anything"
  backup_path="$("$OPS_DIR/backup.sh")" || die "the pre-deploy backup failed, so nothing was changed"
  log "backup: $backup_path"
else
  log "no database yet: first deploy, nothing to back up"
  backup_path=""
fi

export ANAMNESIS_REF="$deploy_ref"

log "starting the database"
compose up -d --wait postgres >/dev/null

log "applying migrations"
if ! compose run --rm migrate; then
  fail "migrations failed. The previous release is still serving. ${backup_path:+Backup taken first: $backup_path}"
fi

log "starting the new release"
compose up -d --no-deps --wait app >/dev/null || true

log "smoke check"
smoke_ok=1
smoke_args="--url http://127.0.0.1:3000 --expect-version ${expected:-dev}"
[ "${SMOKE_SKIP_OLLAMA:-0}" = 1 ] && smoke_args="$smoke_args --skip-ollama"
# An optional dedicated account (see env.production.example) upgrades the check
# from "the pages load" to "a real sign-in reaches the database". The password is
# passed through the environment, not the command line, so it never shows in `ps`.
SMOKE_EMAIL="$(env_value SMOKE_EMAIL)"
SMOKE_PASSWORD="$(env_value SMOKE_PASSWORD)"
export SMOKE_EMAIL SMOKE_PASSWORD
# Run from inside the new release, so the migration count it expects is the one
# that shipped with it, and the path from the container to Ollama is the real one.
# shellcheck disable=SC2086
compose exec -T -e SMOKE_EMAIL -e SMOKE_PASSWORD app node ops/smoke.mjs $smoke_args || smoke_ok=0
# And once from the host, because the published port is part of what has to work.
curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/health" >/dev/null || smoke_ok=0

if [ "$smoke_ok" = 1 ]; then
  printf '%s' "$deploy_ref" >"$STATE_DIR/current-ref"
  printf '%s' "$digest" >"$STATE_DIR/current-digest"
  rm -f "$STATE_DIR/failed-digest"
  log "DEPLOYED ${release:-$REF}"
  exit 0
fi

if [ -n "$previous_ref" ]; then
  log "smoke check failed — putting the previous release back"
  export ANAMNESIS_REF="$previous_ref"
  compose up -d --no-deps --wait app >/dev/null || true
  if curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/health" >/dev/null; then
    log "previous release is serving again"
  else
    log "WARNING: the previous release is not healthy either — check 'docker compose logs app'"
  fi
else
  log "smoke check failed on the first deploy — stopping the app"
  compose stop app >/dev/null
fi
fail "the smoke check failed. ${backup_path:+Backup taken first: $backup_path}"
