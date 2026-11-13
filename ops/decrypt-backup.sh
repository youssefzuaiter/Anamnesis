#!/usr/bin/env bash
# Turns an encrypted off-site copy back into a normal backup folder.
#
#   ops/decrypt-backup.sh <anamnesis-STAMP.tar.age> --identity <private key file> [--out <new folder>]
#
# Prints the backup folder it made (and nothing else) on stdout: that folder is exactly what
# ops/verify-backup.sh and ops/restore.sh take. It needs the PRIVATE key, which is not kept on this
# machine; run it where you have the key file, or copy the key here for the restore and remove it after.
#
# Anyone who can write to the drive can encrypt a file to your public key, so a copy is not trusted just
# because it decrypts: before anything is extracted, every entry must be a plain file or folder inside one
# folder named for the copy, and afterwards the files must match their own SHA256SUMS. A copy that fails
# either leaves nothing behind.
set -euo pipefail
# shellcheck source=ops/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() { die "usage: ops/decrypt-backup.sh <anamnesis-STAMP.tar.age> --identity <key file> [--out <new folder>]"; }

file=""
identity=""
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) [ $# -ge 2 ] || usage; identity="$2"; shift 2 ;;
    --out) [ $# -ge 2 ] || usage; out="$2"; shift 2 ;;
    -*) usage ;;
    *) [ -z "$file" ] || usage; file="$1"; shift ;;
  esac
done
[ -n "$file" ] && [ -n "$identity" ] || usage
need age
need tar
[ -f "$file" ] || die "$file does not exist"
[ -f "$identity" ] || die "the key file $identity does not exist"

base="$(basename "$file")"
printf '%s' "$base" | grep -Eq '^anamnesis-[0-9]{8}T[0-9]{6}Z\.tar\.age$' \
  || die "$base is not named like a copy (anamnesis-YYYYMMDDTHHMMSSZ.tar.age)"
name="${base%.tar.age}"
[ -n "$out" ] || out="$BACKUP_DIR/from-offsite-${name#anamnesis-}"
[ ! -e "$out" ] || die "$out already exists; choose a folder that does not"

umask 077
mkdir "$out"
# A copy can carry a folder with no permissions at all; make everything ours before removing it.
trap 'chmod -R u+rwX "$out" 2>/dev/null; rm -rf "$out"' EXIT

archive="$out/.archive.tar"
age -d -i "$identity" -o "$archive" "$file" 2>/dev/null \
  || die "could not decrypt $base: wrong key, or the file is damaged"

# Entry types: only plain files and folders (the first character of a verbose listing).
types="$(tar -tvf "$archive" | cut -c1)" || die "$base does not hold a readable archive"
printf '%s\n' "$types" | grep -vq '^[-d]$' && die "$base holds something other than plain files and folders, so it is not a backup this tool made"
# Names: the one folder, and flat files directly inside it. No path can climb out or start at the root.
names="$(tar -tf "$archive")"
[ -n "$names" ] || die "$base is empty"
[ "$(printf '%s\n' "$names" | wc -l | tr -d ' ')" = "$(printf '%s\n' "$types" | wc -l | tr -d ' ')" ] || die "$base has entries this tool cannot list safely"
printf '%s\n' "$names" | grep -Evq "^${name}(/|/[A-Za-z0-9][A-Za-z0-9._-]*)$" && die "$base holds a path outside $name/, so it is not a backup this tool made"
printf '%s\n' "$names" | grep -Fxq "$name/SHA256SUMS" || die "$base has no SHA256SUMS, so it cannot be checked"

tar -xf "$archive" -C "$out" -o
rm -f "$archive"
[ -d "$out/$name" ] || die "$base did not contain the folder $name"
(cd "$out/$name" && sha256 -c SHA256SUMS >/dev/null 2>&1) || die "the checksums inside $base do not match its files (checksum failure), so it is not trusted"

trap - EXIT
log "decrypted $base into $out/$name; check it with ops/verify-backup.sh, restore it with ops/restore.sh"
printf '%s\n' "$out/$name"
