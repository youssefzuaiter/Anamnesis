#!/usr/bin/env bash
# Proves an encrypted off-site copy can be decrypted AND restored, with your private key.
#
#   ops/verify-offsite.sh --identity <private key file> [<copy file>]     # default: the newest copy
#
# A copy you cannot decrypt is not a backup. Run this once after setting off-site copies up, and now and
# then after: it needs the private key, which this machine does not keep, so it is the one check that
# cannot run by itself. It decrypts into a temporary folder, restores that into a throwaway database with
# ops/verify-backup.sh, and removes the folder. It never touches production.
set -euo pipefail
# shellcheck source=ops/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() { die "usage: ops/verify-offsite.sh --identity <private key file> [<copy file>]"; }

identity=""
file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) [ $# -ge 2 ] || usage; identity="$2"; shift 2 ;;
    -*) usage ;;
    *) [ -z "$file" ] || usage; file="$1"; shift ;;
  esac
done
[ -n "$identity" ] || usage
need docker

if [ -z "$file" ]; then
  dir="$(offsite_dir)"
  [ -n "$dir" ] || die "OFFSITE_DIR is not set, so there is no folder to take the newest copy from; pass a copy file"
  [ -d "$dir" ] || die "the off-site folder $dir is not available: is the drive plugged in and mounted?"
  file="$(find "$dir" -maxdepth 1 -type f -name 'anamnesis-*.tar.age' | sort | tail -n 1)"
  [ -n "$file" ] || die "no encrypted copies in $dir"
fi

umask 077
scratch="$(mktemp -d "${TMPDIR:-/tmp}/anamnesis-offsite-verify.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

log "decrypting $(basename "$file")"
restored="$("$OPS_DIR/decrypt-backup.sh" "$file" --identity "$identity" --out "$scratch/restored")"
"$OPS_DIR/verify-backup.sh" "$restored"
log "OFF-SITE COPY VERIFIED: $(basename "$file") decrypts with that key and restores"
