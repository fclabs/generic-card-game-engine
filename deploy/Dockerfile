# Phase 0 multi-stage image (FR-050–FR-054). Build context = repo root.
# Pin must match .nvmrc (22.23.3) and packageManager (pnpm@10.15.1).
FROM node:22.23.3-alpine3.24 AS base

WORKDIR /app

RUN corepack enable \
  && corepack prepare pnpm@10.15.1 --activate

# Manifests only — keeps the install layer cacheable (FR-051).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/app/package.json packages/app/
COPY packages/config/package.json packages/config/
COPY packages/helpers/package.json packages/helpers/
COPY packages/conformance/package.json packages/conformance/
COPY packages/server/package.json packages/server/
COPY packages/adapters/store-memory/package.json packages/adapters/store-memory/
COPY packages/adapters/store-sqlite/package.json packages/adapters/store-sqlite/
COPY packages/adapters/transport-http/package.json packages/adapters/transport-http/
COPY packages/adapters/transport-ws/package.json packages/adapters/transport-ws/
COPY packages/adapters/authz-static/package.json packages/adapters/authz-static/
COPY packages/adapters/timer-host/package.json packages/adapters/timer-host/
COPY tools/guardrails/package.json tools/guardrails/

RUN pnpm install --frozen-lockfile

FROM base AS build

COPY . .
RUN pnpm build
# Bundle hook modules, then stage only game.yaml and dist/ of each game (DFR-081).
RUN pnpm bundle:games \
  && mkdir -p /out/games \
  && for d in games/*/; do \
    if [ -f "${d}game.yaml" ]; then \
      n=$(basename "$d"); \
      mkdir -p "/out/games/$n"; \
      cp "${d}game.yaml" "/out/games/$n/game.yaml"; \
      if [ -d "${d}dist" ]; then cp -R "${d}dist" "/out/games/$n/dist"; fi; \
    fi; \
  done

FROM build AS test

RUN pnpm lint && pnpm typecheck && pnpm depcheck
CMD ["pnpm", "test:all"]

# Fresh base image — not derived from build (FR-050 / FR-054).
FROM node:22.23.3-alpine3.24 AS runtime

WORKDIR /app

RUN corepack enable \
  && corepack prepare pnpm@10.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/app/package.json packages/app/
COPY packages/config/package.json packages/config/
COPY packages/helpers/package.json packages/helpers/
COPY packages/conformance/package.json packages/conformance/
COPY packages/server/package.json packages/server/
COPY packages/adapters/store-memory/package.json packages/adapters/store-memory/
COPY packages/adapters/store-sqlite/package.json packages/adapters/store-sqlite/
COPY packages/adapters/transport-http/package.json packages/adapters/transport-http/
COPY packages/adapters/transport-ws/package.json packages/adapters/transport-ws/
COPY packages/adapters/authz-static/package.json packages/adapters/authz-static/
COPY packages/adapters/timer-host/package.json packages/adapters/timer-host/
COPY tools/guardrails/package.json tools/guardrails/

COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/app/dist packages/app/dist
COPY --from=build /app/packages/config/dist packages/config/dist
COPY --from=build /app/packages/helpers/dist packages/helpers/dist
COPY --from=build /app/packages/conformance/dist packages/conformance/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/adapters/store-memory/dist packages/adapters/store-memory/dist
COPY --from=build /app/packages/adapters/store-sqlite/dist packages/adapters/store-sqlite/dist
COPY --from=build /app/packages/adapters/transport-http/dist packages/adapters/transport-http/dist
COPY --from=build /app/packages/adapters/transport-ws/dist packages/adapters/transport-ws/dist
COPY --from=build /app/packages/adapters/authz-static/dist packages/adapters/authz-static/dist
COPY --from=build /app/packages/adapters/timer-host/dist packages/adapters/timer-host/dist

# Game definitions (empty directory when there are no games).
COPY --from=build /out/games /app/games

RUN pnpm install --prod --frozen-lockfile \
  && rm -rf tools \
  && mkdir -p /data \
  && chown node:node /data \
  && chown -R root:root /app \
  && chmod -R a-w /app

USER node
ENV NODE_ENV=production
VOLUME ["/data"]
CMD ["node", "packages/server/dist/index.js"]
