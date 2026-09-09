# syntax=docker/dockerfile:1.7
#
# Four stages, three of them only to keep the last one small: the image that ships holds the
# bundle, the production dependencies and nothing else — no sources, no compiler, no pnpm store.
#
#   docker build -t social-api .

# Debian rather than Alpine: sharp and @node-rs/argon2 ship prebuilt binaries for glibc, and a
# musl image would either rebuild them from source or fail at the first hash.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Dependencies alone, so the layer is reused for as long as the lockfile is unchanged.
# `--ignore-scripts` blocks arbitrary code from the dependency tree at build time; sharp and
# argon2 ship prebuilt binaries, so nothing here needs to run to be usable.
FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm build

# MongoDB has no migration step: collections appear on first write. Indexes do have to be
# created, and doing it at boot on every instance is a race, so this stage runs it once.
FROM build AS indexes
ENV NODE_ENV=production
CMD ["pnpm", "db:indexes"]

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Never root, and never able to rewrite its own code: the whole tree belongs to another user.
USER node
EXPOSE 3000

# Compiled in, so the orchestrator learns about a dead process without an extra binary in the
# image. `/ready` also reports the database and Redis, which is what "can serve" really means.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT??3000)+'/ready').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/server.js"]
