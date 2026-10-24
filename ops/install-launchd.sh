#!/usr/bin/env bash
# Installs (or removes) the three scheduled jobs on macOS:
#   update  — every 5 minutes: deploy a newly promoted release
#   backup  — every night at 03:15
#   verify  — Sundays 04:30: restore the newest backup into a scratch database
#
#   ops/install-launchd.sh [--uninstall]
#
# These are per-user LaunchAgents, so they run while you are logged in, and they
# are plain files in ~/Library/LaunchAgents that --uninstall removes again.
set -euo pipefail
# shellcheck source=ops/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ "$(uname -s)" = Darwin ] || die "this installer is for macOS; on Linux use cron or systemd timers to run the same scripts"

AGENTS="$HOME/Library/LaunchAgents"
JOBS="update backup verify"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
  for job in $JOBS; do
    launchctl bootout "$DOMAIN/com.anamnesis.$job" 2>/dev/null || true
    rm -f "$AGENTS/com.anamnesis.$job.plist"
    log "removed com.anamnesis.$job"
  done
  exit 0
fi

need docker
require_env_file
mkdir -p "$AGENTS" "$STATE_DIR"

# launchd starts jobs with a nearly empty PATH, which would not find docker or
# node. Capture the one this shell found them in.
JOB_PATH="$(dirname "$(command -v docker)"):$(dirname "$(command -v node 2>/dev/null || echo /usr/local/bin/node)"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

for job in $JOBS; do
  target="$AGENTS/com.anamnesis.$job.plist"
  sed -e "s#@ROOT@#$ROOT#g" -e "s#@PATH@#$JOB_PATH#g" \
    "$OPS_DIR/launchd/com.anamnesis.$job.plist.template" >"$target"
  plutil -lint "$target" >/dev/null || die "generated $target is not a valid plist"
  launchctl bootout "$DOMAIN/com.anamnesis.$job" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$target"
  log "installed com.anamnesis.$job"
done

log "logs: $STATE_DIR/{update,backup,verify}.log   |   remove everything with: ops/install-launchd.sh --uninstall"
