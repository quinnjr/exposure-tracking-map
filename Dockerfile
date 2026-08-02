# syntax=docker/dockerfile:1

# =============================================================================
# Bun builds; Node installs and serves. Why, precisely:
#
#   1. Bun's runtime cannot load this app's SQLite driver. Observed on Bun
#      1.3.14: `better-sqlite3` fails with ERR_DLOPEN_FAILED (oven-sh/bun#4290),
#      and `node:sqlite`, which the Prisma 7 chain also reaches for, is not
#      implemented in Bun.
#   2. `bun install` does not merely fail to build that native module — it
#      does not install it at all. Observed on the same Bun version:
#      `@prisma/adapter-better-sqlite3` lands, its `better-sqlite3` dependency
#      does not. So Bun cannot own the dependency tree either.
#   3. Bun CAN run `prisma generate` and the Vite/SvelteKit build, which is
#      where it is genuinely fast.
#
# Hence: pnpm installs a lockfile-faithful tree with a correctly-built native
# module, Bun consumes that tree to build, and Node serves the result.
# Collapsing this to one runtime would mean replacing a working data layer,
# which is not a trade worth making for a container.
# =============================================================================

# ---- Stage 1: dependency tree + Prisma client, on Node ----------------------
FROM node:22-alpine AS deps
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
FROM oven/bun:1.3-alpine AS build
WORKDIR /app

# Reuse the tree pnpm produced. Every stage is Alpine/musl, so the native
# binary is ABI-compatible across the copy; the build only resolves it anyway,
# it is dlopen'd for the first time in the runtime stage.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `--bun` forces Bun's own runtime. Without it, `bun run` honours each script's
# node shebang and shells out to node, which does not exist in this image.
ENV DATABASE_URL="file:/tmp/build-placeholder.db"
RUN bun --bun run vite build

# ---- Stage 3: prune to production deps --------------------------------------
# Pruning must happen in a stage the runtime does NOT inherit. Docker layers are
# additive: copying the full dev tree and pruning afterwards leaves both the
# ~494 MB copy and the rewrite in the final image. Here the dev tree never
# crosses the boundary — only the pruned result does.
#
# `pnpm prune --prod` alone is not enough: it rewrites the top-level symlinks
# but leaves every package physically present in the .pnpm virtual store. And a
# clean `pnpm install --prod` is no better, because @prisma/client declares a
# PEER DEPENDENCY on the `prisma` CLI — so a production install still drags in
# Studio, effect, TypeScript and pglite: ~170 MB the server never imports.
#
# So the fat is removed explicitly. Every entry below is a build- or CLI-time
# concern, or client-side only. If you add one, verify it by running the image
# and exercising /api/sites, /api/search and /api/sites/[epaId] — a wrongly
# deleted package fails at request time, not at build time.
FROM deps AS pruned
# --ignore-scripts is load-bearing: package.json defines `prepare: svelte-kit
# sync`, and pnpm 11.18.0 (pinned above) fires lifecycle hooks during prune.
# That hook would run while prune is removing @sveltejs/kit itself, failing
# with "svelte-kit: not found". This flag is defensive regardless of that
# behaviour — nothing here needs a lifecycle script, the app is already built.
RUN pnpm prune --prod --ignore-scripts \
 && rm -rf \
      node_modules/.pnpm/prisma@*                `# CLI: generate already ran` \
      node_modules/.pnpm/@prisma+studio-core@*   `# Prisma Studio, a dev GUI` \
      node_modules/.pnpm/@prisma+dev@*           `# dev-only tooling` \
      node_modules/.pnpm/effect@*                `# pulled in by the CLI` \
      node_modules/.pnpm/typescript@*            `# build-time only` \
      node_modules/.pnpm/@electric-sql+pglite@*  `# Postgres-in-WASM, unused here` \
      node_modules/.pnpm/maplibre-gl@*           `# client-side only; in the browser bundle` \
      node_modules/.pnpm/@types+*                `# types are compile-time` \
      node_modules/.pnpm/react@* \
      node_modules/.pnpm/react-dom@*             `# Studio's UI, not this app` \
      node_modules/.pnpm/@prisma+engines@*       `# schema engine: migrations only, ~21 MB` \
 && find node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/runtime \
      -name 'query_compiler_*' ! -name '*sqlite*' -delete
# Prisma ships a WASM query compiler for every database it supports — SQL Server,
# PostgreSQL, CockroachDB and MySQL are ~4.7 MB each in both .js and .mjs. This
# app's datasource provider is sqlite, so only the sqlite compiler can ever load.

# ---- Stage 4: serve on Node -------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# No package manager installed here: node_modules arrives prebuilt, and the
# entrypoint is plain `node`. That alone drops the ~52 MB global pnpm install.
COPY package.json ./
COPY --from=pruned /app/node_modules ./node_modules
COPY --from=build /app/build ./build

# The database is mounted, never baked in: ~3 MB of ingested EPA data with its
# own lifecycle. `pnpm download` populates it; see README.
ENV DATABASE_URL="file:/data/dev.db"
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "build/index.js"]
