#!/usr/bin/env bash
# Takes one backup: the database and the attachment files, together.
#
#   ops/backup.sh [--no-prune]
#
# Both halves matter. Attachment bytes live on disk, not in Postgres, so a
# database dump alone would restore notes whose files are gone.
#
# Backups contain personal data. They are written with owner-only permissions to
# a directory OUTSIDE the repository, and must never be uploaded anywhere
# public — including as a GitHub Actions artifact, which on a public repository
# is downloadable by anyone.
set -euo pipefail
# shellcheck source=ops/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PRUNE=1
[ "${1:-}" = "--no-prune" ] && PRUNE=0

need docker
require_env_file
compose ps --status running --services 2>/dev/null | grep -qx postgres \
  || die "the postgres container is not running, so there is nothing to back up"

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dest="$BACKUP_DIR/anamnesis-$stamp"
# Built under a name no restore or prune will ever treat as a backup, then
# renamed in one step: a half-written backup can never be mistaken for a good one.
work="$BACKUP_DIR/.incomplete-$stamp"
trap 'rm -rf "$work"' EXIT
mkdir "$work"

log "dumping the database"
compose exec -T postgres pg_dump -U "$PGUSER" -d "$PGDB" \
  --format=custom --no-owner --no-privileges >"$work/database.dump"

# A dump that cannot be read back is not a backup. Listing it is cheap and
# catches truncation and corruption; the weekly verify-backup.sh goes further.
compose exec -T postgres pg_restore --list <"$work/database.dump" >/dev/null \
  || die "the dump was written but cannot be read back — keeping the previous backups"

log "archiving attachments"
docker run --rm --entrypoint sh \
  -v "$ATTACH_VOLUME":/data:ro -v "$work":/out "$HELPER_IMAGE" \
  -c "tar -C /data -cf /out/attachments.tar . && chown $(id -u):$(id -g) /out/attachments.tar && chmod 600 /out/attachments.tar"

# What the data looked like at this moment, so a restore can be checked against
# it rather than against a hope.
{
  for table in $COUNTED_TABLES; do
    printf '%s %s\n' "$table" "$(psql_query "SELECT count(*) FROM \"$table\"")"
  done
  printf 'migrations %s\n' "$(psql_query 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
  printf 'attachment_files %s\n' "$(tar -tf "$work/attachments.tar" | grep -vc '/$' || true)"
} >"$work/counts.txt"

release="unknown"
app_container="$(compose ps -q app 2>/dev/null || true)"
if [ -n "$app_container" ]; then
  release="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$app_container" 2>/dev/null || echo unknown)"
fi

cat >"$work/manifest.json" <<EOF
{
  "created": "$stamp",
  "release": "${release:-unknown}",
  "database_bytes": $(wc -c <"$work/database.dump" | tr -d ' '),
  "attachments_bytes": $(wc -c <"$work/attachments.tar" | tr -d ' ')
}
EOF

(cd "$work" && sha256 database.dump attachments.tar counts.txt manifest.json >SHA256SUMS)

mv "$work" "$dest"
trap - EXIT
log "backup written: $dest"

if [ "$PRUNE" = 1 ]; then
  if command -v node >/dev/null 2>&1; then
    # To stderr: stdout of this script is the backup path and nothing else.
    node "$OPS_DIR/retention.mjs" --dir "$BACKUP_DIR" --apply >&2
  else
    log "node not found — skipping pruning; old backups are kept"
  fi
fi

printf '%s\n' "$dest"
