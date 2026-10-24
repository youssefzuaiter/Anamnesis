#!/usr/bin/env bash
# Proves a backup restores. Restores it into a throwaway database that is not
# production, then compares what came back with what the backup recorded.
#
#   ops/verify-backup.sh [<backup-directory>]      # default: the newest one
#
# A backup nobody has restored is a hope, not a backup. This is safe to run at
# any time: it starts its own container and removes it afterwards, and never
# touches the production database.
set -euo pipefail
# shellcheck source=ops/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need docker

backup="${1:-}"
if [ -z "$backup" ]; then
  backup="$(find "$BACKUP_DIR" -maxdepth 1 -type d -name 'anamnesis-*T*Z' 2>/dev/null | sort | tail -n 1)"
  [ -n "$backup" ] || die "no backups found in $BACKUP_DIR"
fi
[ -d "$backup" ] || die "$backup is not a directory"

log "verifying $(basename "$backup")"
(cd "$backup" && sha256 -c SHA256SUMS >/dev/null) || die "checksums do not match — this backup is damaged"

name="anamnesis-verify-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$name" \
  -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify \
  "$HELPER_IMAGE" >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec "$name" pg_isready -U postgres -d verify >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || die "the scratch database did not start"
# pg_isready answers during the image's own bootstrap, before the real server is
# up; a short pause plus one real query avoids restoring into a server about to restart.
for _ in $(seq 1 30); do
  docker exec "$name" psql -U postgres -d verify -Atc 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done

log "restoring into the scratch database"
docker exec -i "$name" pg_restore -U postgres -d verify --no-owner --no-privileges \
  <"$backup/database.dump" || die "pg_restore reported errors"

scratch_count() {
  docker exec "$name" psql -U postgres -d verify -At -c "$1" | tr -d '[:space:]'
}

failures=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    log "  ok    $1: $3"
  else
    log "  FAIL  $1: backup recorded $2, restore produced $3"
    failures=$((failures + 1))
  fi
}

while read -r table expected; do
  case "$table" in
    migrations)
      check "applied migrations" "$expected" \
        "$(scratch_count 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')" ;;
    attachment_files)
      check "attachment files" "$expected" \
        "$(tar -tf "$backup/attachments.tar" | grep -vc '/$' || true)" ;;
    *)
      check "$table rows" "$expected" "$(scratch_count "SELECT count(*) FROM \"$table\"")" ;;
  esac
done <"$backup/counts.txt"

check "pgvector extension" 1 "$(scratch_count "SELECT count(*) FROM pg_extension WHERE extname = 'vector'")"

if [ "$failures" -ne 0 ]; then
  die "$failures check(s) failed — do not rely on $(basename "$backup")"
fi
log "BACKUP VERIFIED: $(basename "$backup")"
