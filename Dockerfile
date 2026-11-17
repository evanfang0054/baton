# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS toolchain
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM toolchain AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/daemon/package.json apps/daemon/
COPY apps/web/package.json apps/web/
COPY packages/protocol/package.json packages/protocol/
COPY packages/core/package.json packages/core/
COPY packages/adapters/package.json packages/adapters/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM toolchain AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/daemon/package.json apps/daemon/
COPY apps/web/package.json apps/web/
COPY packages/protocol/package.json packages/protocol/
COPY packages/core/package.json packages/core/
COPY packages/adapters/package.json packages/adapters/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates ripgrep openssh-client tini \
 && rm -rf /var/lib/apt/lists/*
RUN git config --system --add safe.directory /workspace
WORKDIR /app
ENV NODE_ENV=production \
    BATON_HOST=0.0.0.0 \
    BATON_PORT=7317 \
    BATON_DATA_DIR=/data \
    BATON_WORKSPACES_ROOT=/workspace \
    BATON_WEB_ROOT=/app/apps/daemon/dist/web \
    BATON_MIGRATIONS_DIR=/app/apps/daemon/dist/migrations
COPY --from=prod-deps --chown=node:node /app/node_modules /app/node_modules
COPY --from=prod-deps --chown=node:node /app/apps/daemon/node_modules /app/apps/daemon/node_modules
COPY --from=build --chown=node:node /app/apps/daemon/dist /app/apps/daemon/dist
COPY --from=build --chown=node:node /app/apps/daemon/package.json /app/apps/daemon/package.json
RUN mkdir -p /data /workspace /home/node/.claude \
 && chown -R node:node /data /workspace /home/node/.claude
USER node
EXPOSE 7317
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7317/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "node", "apps/daemon/dist/index.js"]
