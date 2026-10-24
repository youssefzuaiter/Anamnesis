#!/usr/bin/env bash
# First-time setup of the production stack on this machine. Safe to re-run: it
# never overwrites an existing .env.production.
#
#   ops/bootstrap.sh
#
# It creates the secrets file and the backup directory and checks prerequisites.
# It does not start anything; the first deploy is `ops/update.sh` once a release
# has been promoted in GitHub (or `ops/deploy.sh --ref <image>` for a specific one).
set -euo pipefail
# shellcheck source=ops/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need docker
need openssl
docker info >/dev/null 2>&1 || die "Docker is installed but not running"

if [ -f "$ENV_FILE" ]; then
  log "$ENV_FILE already exists — leaving it alone"
else
  umask 077
  {
    printf '# Created by ops/bootstrap.sh. Never commit or share this file.\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)"
    # base64 of 48 bytes is 64 characters; the app requires at least 32.
    printf 'NEXTAUTH_SECRET=%s\n' "$(openssl rand -base64 48 | tr -d '\n')"
    printf 'NEXTAUTH_URL=http://localhost:3200\n'
    printf 'ANAMNESIS_PORT=3200\n'
    printf 'OLLAMA_BASE_URL=http://host.docker.internal:11434\n'
    printf 'OLLAMA_CHAT_MODEL=llama3.2:3b\n'
    printf 'OLLAMA_EMBEDDING_MODEL=nomic-embed-text\n'
  } >"$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "wrote $ENV_FILE with freshly generated secrets (mode 600)"
fi

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
log "backups will be written to $BACKUP_DIR (owner-only, outside the repository)"

if curl -fsS --max-time 3 "$(env_value OLLAMA_BASE_URL x | sed 's#host.docker.internal#127.0.0.1#')/api/tags" >/dev/null 2>&1; then
  log "Ollama is answering on this machine"
else
  log "WARNING: Ollama is not answering. Start it with 'ollama serve' and pull the models:"
  log "         ollama pull llama3.2:3b && ollama pull nomic-embed-text"
fi

cat >&2 <<EOF

Next:
  1. Promote a release in GitHub (Actions → "Publish and promote" → approve the production deployment).
  2. ops/update.sh --force          # deploys it
  3. ops/install-launchd.sh         # optional: check for releases every 5 minutes, back up daily
EOF
