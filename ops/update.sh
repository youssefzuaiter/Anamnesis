#!/usr/bin/env bash
# Checks whether a new release has been promoted, and deploys it if so.
#
#   ops/update.sh [--force]
#
# This is the whole of the "pull" half of the deploy design. GitHub never
# reaches into this machine and holds no credentials for it: promoting a release
# in GitHub moves the `production` tag on the published image, and this script,
# run every few minutes by launchd, notices the tag moved. --force retries a
# release that failed before.
#
# Everything is inside one function that ends in `exec`, because bash reads a
# script as it runs: replacing the file part-way through (the git checkout below
# can do exactly that) would otherwise make it execute a mixture of two versions.
set -euo pipefail
# shellcheck source=ops/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  local force=0
  [ "${1:-}" = "--force" ] && force=1

  need docker
  require_env_file
  mkdir -p "$STATE_DIR"

  # A deploy already in progress is not an error; the next run will look again.
  if lock_held_by_other; then exit 0; fi

  local remote current failed
  # The digest is read from the report's "Digest:" line rather than with
  # --format, which not every buildx honours. It is the same value the registry
  # returns as Docker-Content-Digest for the tag.
  if ! remote="$(docker buildx imagetools inspect "$IMAGE:production" 2>/dev/null | awk '/^Digest:/{print $2; exit}')" \
     || [ -z "$remote" ]; then
    log "registry not reachable or no production release yet — will look again"
    exit 0
  fi
  current="$(cat "$STATE_DIR/current-digest" 2>/dev/null || true)"
  failed="$(cat "$STATE_DIR/failed-digest" 2>/dev/null || true)"

  [ "$remote" = "$current" ] && exit 0
  if [ "$remote" = "$failed" ] && [ "$force" = 0 ]; then
    log "release $remote already failed here; waiting for a newer one (or run with --force)"
    exit 0
  fi

  log "new release promoted: $remote"
  docker pull "$IMAGE@$remote" >/dev/null

  # The scripts and the compose file that deploy a release are the ones from that
  # release, so a rollback or an old promotion never runs against newer tooling.
  local sha
  sha="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE@$remote")"
  if [ -d "$ROOT/.git" ] && [ -n "$sha" ] && [ "$sha" != "dev" ]; then
    git -C "$ROOT" diff --quiet || die "the checkout has local changes; refusing to switch it to $sha"
    git -C "$ROOT" fetch --quiet origin
    git -C "$ROOT" checkout --quiet --detach "$sha" || die "could not check out $sha"
  fi

  exec "$ROOT/ops/deploy.sh" --ref "$IMAGE@$remote" --no-pull
}

main "$@"
exit 1
