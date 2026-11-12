# Flock: one image, run against a given DATABASE_URL. Migrations run on boot.
#   docker build -t flock . && docker run -p 2100:2100 -e DATABASE_URL=postgres://... flock
# The server runs its TypeScript sources directly (Node 24 strips types). Workspace
# packages stay symlinked outside node_modules, where Node allows type stripping.
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/server/package.json packages/server/
COPY packages/shared/package.json packages/shared/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/script/package.json packages/script/
COPY playground/package.json playground/

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY packages packages
RUN pnpm --filter @flock/dashboard build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@flock/server..."

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=2100
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/packages/server/node_modules packages/server/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules packages/shared/node_modules
COPY package.json ./
COPY packages/server/package.json packages/server/
COPY packages/server/src packages/server/src
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY --from=build /app/packages/dashboard/dist packages/dashboard/dist
USER node
EXPOSE 2100
CMD ["node", "packages/server/src/main.ts"]
