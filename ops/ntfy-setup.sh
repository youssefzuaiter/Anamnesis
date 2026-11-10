#!/usr/bin/env bash
# Adds what phone reminders need to .env.production: a publish token for the app, an ntfy account for
# the app and one for the phone (passwords stored as bcrypt hashes, made by the pinned ntfy image), the
# phone's password in clear so it can be typed into the ntfy app, and the host's time zone. Safe to run
# again: a value that is already there is never changed. See "Phone reminders" in ops/README.md.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Keep in step with the ntfy image in compose.prod.yml.
NTFY_IMAGE="binwiederhier/ntfy:v2.34.0"

need docker
need openssl
require_env_file

# `ntfy user hash` asks for the password twice on stdin and prints the hash last.
hash_password() {
  printf '%s\n%s\n' "$1" "$1" | docker run --rm -i "$NTFY_IMAGE" user hash 2>/dev/null \
    | tr -d '\r' | grep -oE '\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}' | tail -n 1
}

# add NAME VALUE [quoted]: appends NAME=VALUE unless NAME is already set.
add() {
  if [ -z "$(env_value "$1")" ]; then
    if [ "${3:-}" = quoted ]; then printf "%s='%s'\n" "$1" "$2" >>"$ENV_FILE"; else printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE"; fi
    log "added $1 to $ENV_FILE"
  fi
}

umask 077

if [ -z "$(env_value NTFY_APP_TOKEN)" ]; then
  docker info >/dev/null 2>&1 || die "Docker is installed but not running"
  app_password="$(openssl rand -hex 24)"
  phone_password="$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | cut -c1-20)"
  app_hash="$(hash_password "$app_password")"
  phone_hash="$(hash_password "$phone_password")"
  [ -n "$app_hash" ] && [ -n "$phone_hash" ] || die "could not hash the ntfy passwords with $NTFY_IMAGE"
  add NTFY_APP_PASSWORD_HASH "$app_hash" quoted
  add NTFY_PHONE_PASSWORD "$phone_password"
  add NTFY_PHONE_PASSWORD_HASH "$phone_hash" quoted
  # Written last: its presence is what switches reminders on (ops/lib.sh, compose.prod.yml).
  add NTFY_APP_TOKEN "tk_$(openssl rand -hex 32 | cut -c1-29)"
fi

# macOS: /etc/localtime -> /var/db/timezone/zoneinfo/Europe/Istanbul. Linux: /usr/share/zoneinfo/...
host_tz="$(readlink /etc/localtime 2>/dev/null | sed -n 's#.*zoneinfo/##p')"
add TZ "${host_tz:-UTC}"
add NTFY_PUBLIC_URL "http://localhost:2586"

chmod 600 "$ENV_FILE"
log "phone reminders are set up; the ntfy app signs in as 'phone' with NTFY_PHONE_PASSWORD from $ENV_FILE"
