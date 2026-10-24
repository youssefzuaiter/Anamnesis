# syntax=docker/dockerfile:1
#
# One image runs both the app and its migrations. `prisma` is a runtime
# dependency for exactly that reason: the deploy script runs
# `prisma migrate deploy` from this same image, so the migrations that ship are
# always the ones that were built alongside the code that expects them.

# Literal tags, not a build argument: Dependabot reads the tag from the FROM line
# and cannot evaluate ${...}, so an interpolated one would never be updated.
FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    # pnpm 11 checks the lockfile against supply-chain age policies, which needs
    # each package's FULL metadata, not the abbreviated form installs normally use.
    # Cold, that is several hundred large documents; the defaults give up too soon.
    NPM_CONFIG_FETCH_TIMEOUT=300000 \
    NPM_CONFIG_FETCH_RETRIES=5
RUN npm install --global pnpm@11.11.0
WORKDIR /app

# lib/config.ts validates the environment the moment it is imported, and
# `prisma generate` reads DATABASE_URL, so both the install and the build need
# values that merely look right. They are build-stage only and never reach the
# runner: nothing here connects to anything.
FROM base AS build-env
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    OLLAMA_BASE_URL=http://localhost:11434 \
    OLLAMA_CHAT_MODEL=llama3.2:3b \
    OLLAMA_EMBEDDING_MODEL=nomic-embed-text

# Dependencies first, so editing application code does not reinstall them. The
# prisma files come along because the root `postinstall` runs `prisma generate`.
FROM build-env AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-metadata,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# The one value that has to be at least 32 characters is given inline, to this
# command only, rather than as an ENV that every later layer would carry.
RUN NEXTAUTH_SECRET=build-only-placeholder-that-is-never-used-at-runtime \
    sh -c 'pnpm exec prisma generate && pnpm build'

# Production dependencies, made by pruning the full install rather than by a
# second one: it avoids downloading everything twice, and the engine binary that
# `prisma migrate deploy` needs (fetched by @prisma/engines at install time) is
# already in place.
FROM deps AS prod-deps
RUN pnpm prune --prod

FROM node:24-bookworm-slim AS runner
# openssl: Prisma's schema engine links against it.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 1001 --create-home app
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next ./.next
COPY --chown=app:app public ./public
COPY --chown=app:app package.json next.config.ts prisma.config.ts ./
COPY --chown=app:app prisma ./prisma
COPY --chown=app:app ops ./ops

# Attachment bytes live on disk (see lib/attachment-store.ts), so this path is a
# volume in production. Creating it here, owned by the app user, is what makes a
# fresh named volume mounted over it writable.
RUN mkdir -p /app/data/attachments && chown -R app:app /app/data

# Set last so that a new commit invalidates only the layers below this line.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.source="https://github.com/youssefzuaiter/Anamnesis" \
      org.opencontainers.image.revision=${APP_VERSION}

USER app
EXPOSE 3000

# Shallow on purpose: it checks the database, not Ollama. The app degrades
# without the model server, and restarting it over that would only add outage.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./node_modules/.bin/next", "start", "--port", "3000"]
