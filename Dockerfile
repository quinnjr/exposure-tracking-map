# syntax=docker/dockerfile:1

# =============================================================================
# Bun builds; Node installs and serves. Why, precisely:
#
#   1. Bun's runtime cannot load this app's SQLite driver. Verified on Bun
#      1.3.14: `better-sqlite3` fails with ERR_DLOPEN_FAILED (oven-sh/bun#4290),
#      and `node:sqlite`, which the Prisma 7 chain also reaches for, is not
#      implemented in Bun.
#   2. `bun install` does not merely fail to build that native module — it
#      does not install it at all. Verified: `@prisma/adapter-better-sqlite3`
#      lands, its `better-sqlite3` dependency does not. So Bun cannot own the
#      dependency tree either.
#   3. Bun CAN run `prisma generate` and the Vite/SvelteKit build, which is
#      where it is genuinely fast.
#
# Hence: pnpm installs a lockfile-faithful tree with a correctly-built native
# module, Bun consumes that tree to build, and Node serves the result.
# Collapsing this to one runtime would mean replacing a working data layer,
# which is not a trade worth making for a container.
# =============================================================================

# ---- Stage 1: dependency tree + Prisma client, on Node ----------------------
FROM node:22-slim AS deps
WORKDIR /app

# Pinned rather than via corepack: this project declares `devEngines.packageManager`
# as a RANGE (`pnpm@^11.13.0`), which corepack rejects — it demands exact semver.
# 11.18.0 is the version that generated the committed lockfile.
RUN npm install -g pnpm@11.18.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# prisma.config.ts resolves env('DATABASE_URL') at load time and throws if it is
# absent. `generate` never opens the database, so any well-formed value will do.
ENV DATABASE_URL="file:/tmp/generate-placeholder.db"
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm exec prisma generate

# ---- Stage 2: build the app with Bun ----------------------------------------
FROM oven/bun:1.3 AS build
WORKDIR /app

# Reuse the tree pnpm produced. Both stages are glibc/amd64, and the native
# binary is only dlopen'd at runtime (stage 3) — the build merely resolves it.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `--bun` forces Bun's own runtime. Without it, `bun run` honours each script's
# node shebang and shells out to node, which does not exist in this image.
ENV DATABASE_URL="file:/tmp/build-placeholder.db"
RUN bun --bun run vite build

# ---- Stage 3: serve on Node -------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN npm install -g pnpm@11.18.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY --from=deps /app/node_modules ./node_modules

# Drop devDependencies now that the client is generated and the app is built.
RUN pnpm prune --prod

COPY --from=build /app/build ./build

# The database is mounted, never baked in: ~3 MB of ingested EPA data with its
# own lifecycle. `pnpm download` populates it; see README.
ENV DATABASE_URL="file:/data/dev.db"
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "build/index.js"]
