#!/usr/bin/env bash
# Copies each finished backup, ENCRYPTED, to a folder that is not this machine's disk.
#
#   ops/offsite.sh            copy every backup that has no copy yet, then prune old copies
#   ops/offsite.sh --check    exit 1 unless the newest copy is at most OFFSITE_MAX_AGE_DAYS (3) old
#
# Encrypt first, then copy: each backup folder is tarred and encrypted with `age` to the PUBLIC key
# in OFFSITE_RECIPIENT, so the folder it lands in (an external drive, a NAS mount, a synced folder)
# only ever holds ciphertext, and so does anything that folder is copied to. The private key stays
# with you, never on this machine, so this machine cannot read its own copies either; losing that
# key means losing these copies. Settings, in the environment or .env.production:
#
#   OFFSITE_DIR=/Volumes/Backup/anamnesis      OFFSITE_RECIPIENT=age1...
#
# Exit codes: 0 done (or not configured), 1 error, 3 the folder is not there (drive unplugged).
# Nothing is uploaded anywhere by this script; the destination is a path. Cloud storage would cost money
# and is deliberately not built in; an encrypted file is safe in any synced folder.
set -euo pipefail
# shellcheck source=ops/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

mode=copy
case "${1:-}" in
  "") ;;
  --check) mode=check ;;
  *) die "usage: ops/offsite.sh [--check]" ;;
esac

dir="$(offsite_dir)"
recipient="$(offsite_recipient)"
if [ -z "$dir" ] && [ -z "$recipient" ]; then
  log "off-site copies are not configured (OFFSITE_DIR and OFFSITE_RECIPIENT); nothing to do"
  exit 0
fi
[ -n "$dir" ] || die "OFFSITE_RECIPIENT is set but OFFSITE_DIR is not"
[ -n "$recipient" ] || die "OFFSITE_DIR is set but OFFSITE_RECIPIENT is not"
# Checked before the value is used anywhere, and never printed: a pasted private key must not end up in a
# log, and anything that is not a plain age public key must not reach a command line.
case "$recipient" in
  AGE-SECRET-KEY*) die "OFFSITE_RECIPIENT holds a PRIVATE key. Remove it from the environment and from $ENV_FILE now; only the public key (it starts with age1) belongs here" ;;
esac
printf '%s' "$recipient" | grep -Eq '^age1[0-9a-z]{20,}$' \
  || die "OFFSITE_RECIPIENT is not an age public key (it starts with age1 and has no spaces)"

unavailable() {
  log "the off-site folder $dir is not available: is the drive plugged in and mounted?"
}

if [ "$mode" = check ]; then
  [ -d "$dir" ] || { unavailable; exit 1; }
  need node
  node "$OPS_DIR/retention.mjs" --dir "$dir" --suffix .tar.age --newest-within "${OFFSITE_MAX_AGE_DAYS:-3}" >&2 || exit 1
  exit 0
fi

need age
need tar
[ -d "$dir" ] || { unavailable; exit 3; }
[ -w "$dir" ] || die "the off-site folder $dir is not writable"
[ -d "$BACKUP_DIR" ] || die "there is no backup folder at $BACKUP_DIR"

real_dir="$(cd "$dir" && pwd -P)"
real_backups="$(cd "$BACKUP_DIR" && pwd -P)"
case "$real_dir/" in
  "$real_backups/"*) die "the off-site folder must be a different folder from the backups, not inside it" ;;
esac

umask 077
# A copy is written under a name no prune or restore will treat as a copy, then renamed in one step, so a
# half-written file (a pulled drive, a full disk) can never be mistaken for a good one.
tmp=""
trap '[ -z "$tmp" ] || rm -f "$tmp"' EXIT
# macOS tar would otherwise add ._ files for extended attributes.
export COPYFILE_DISABLE=1

# A run that was killed (power cut, pulled drive) can leave its temporary file; those are ours, by name.
find "$dir" -maxdepth 1 -type f -name '.incomplete-anamnesis-*.tar.age' -mtime +1 -delete 2>/dev/null || true

copied=0
while IFS= read -r backup; do
  name="$(basename "$backup")"
  printf '%s' "$name" | grep -Eq '^anamnesis-[0-9]{8}T[0-9]{6}Z$' || continue
  if [ ! -f "$backup/SHA256SUMS" ]; then
    log "skipping $name: it has no SHA256SUMS, so it is not a finished backup"
    continue
  fi
  final="$dir/$name.tar.age"
  [ -e "$final" ] && continue

  log "encrypting and copying $name"
  # Named for this process, so two runs at once (the nightly backup and a pre-deploy one) never write the
  # same file; each finishes with its own whole file and the later rename replaces the earlier copy.
  tmp="$dir/.incomplete-$name.$$.tar.age"
  if ! tar -C "$BACKUP_DIR" -cf - "$name" | age -r "$recipient" -o "$tmp"; then
    if command -v node >/dev/null 2>&1; then
      node "$OPS_DIR/watch.mjs" --notify "Anamnesis: an off-site copy failed" \
        "An encrypted copy could not be written. The local backups are fine; see ops/state/backup.log." >&2 || true
    fi
    die "could not encrypt $name, so no copy was made of it (the local backup is untouched)"
  fi
  mv "$tmp" "$final"
  tmp=""
  copied=$((copied + 1))
  printf '%s\n' "$final"
done < <(find "$BACKUP_DIR" -maxdepth 1 -type d -name 'anamnesis-*' | sort)

log "off-site: $copied new encrypted file(s) written"
if command -v node >/dev/null 2>&1; then
  node "$OPS_DIR/retention.mjs" --dir "$dir" --suffix .tar.age --apply >&2
else
  log "node not found, skipping pruning of old copies; they are kept"
fi
