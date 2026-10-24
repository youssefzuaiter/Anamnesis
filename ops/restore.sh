#!/usr/bin/env bash
# Restores a backup over the production database and attachments.
#
#   ops/restore.sh <backup-directory> --confirm-overwrite
#
# This replaces what is currently in production with the contents of the backup,
# so it refuses to run without the flag. It takes a fresh backup of the current
# state first — "restore the wrong one" must always be undoable — and stops the
# app while the data is swapped. To only CHECK a backup, use verify-backup.sh,
# which touches nothing.
set -euo pipefail
# shellcheck source=ops/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

backup="${1:-}"
[ -n "$backup" ] && [ -d "$backup" ] || die "usage: ops/restore.sh <backup-directory> --confirm-overwrite"
[ "${2:-}" = "--confirm-overwrite" ] || die "this overwrites production data; pass --confirm-overwrite if that is what you want"

need docker
require_env_file
lock_acquire

(cd "$backup" && sha256 -c SHA256SUMS >/dev/null) || die "checksums do not match — refusing to restore a damaged backup"

log "taking a safety backup of the current state first"
safety="$("$OPS_DIR/backup.sh" --no-prune)" || die "could not back up the current state, so nothing was changed"
log "current state saved to $safety"

log "stopping the app"
compose stop app >/dev/null

log "restoring the database"
compose exec -T postgres pg_restore -U "$PGUSER" -d "$PGDB" \
  --clean --if-exists --no-owner --no-privileges <"$backup/database.dump" \
  || die "pg_restore reported errors; the safety backup is at $safety"

log "restoring attachments"
docker run --rm --entrypoint sh \
  -v "$ATTACH_VOLUME":/data -v "$backup":/in:ro "$HELPER_IMAGE" \
  -c "find /data -mindepth 1 -delete && tar -C /data -xf /in/attachments.tar && chown -R 1001:1001 /data"

[ -n "${ANAMNESIS_REF:-}" ] || die "no deployed release is recorded (ops/state/current-ref), so the app cannot be restarted automatically; data is restored. Start it with ops/deploy.sh."

log "starting the app"
compose up -d --no-deps --wait app >/dev/null || true

log "smoke check"
smoke_args="--url http://127.0.0.1:3000"
[ "${SMOKE_SKIP_OLLAMA:-0}" = 1 ] && smoke_args="$smoke_args --skip-ollama"
# shellcheck disable=SC2086
compose exec -T app node ops/smoke.mjs $smoke_args \
  || die "restored $(basename "$backup"), but the app does not pass its smoke check. The state before this restore is saved at $safety"
log "RESTORED $(basename "$backup") and the app is healthy. The state before the restore is at $safety"
