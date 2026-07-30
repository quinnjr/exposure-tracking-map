# Exposure Tracking Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A SvelteKit app that maps all 1,840 EPA National Priorities List Superfund sites and, given a US address, lists nearby sites ranked by straight-line distance with their contaminants and human-exposure status.

**Architecture:** A CLI downloader ingests three EPA sources into SQLite via Prisma. Server routes geocode addresses through the keyless US Census geocoder, prefilter sites with an indexed bounding-box query, and rank with haversine in JS. The UI is one page: a MapLibre GL map with clustered pins plus a keyboard-navigable results list, both opening the same detail dialog.

**Tech Stack:** SvelteKit 2 (`adapter-node`), Svelte 5 runes, Tailwind v4, Prisma 6 + SQLite, MapLibre GL JS, OpenFreeMap tiles, Vitest, Playwright, pnpm, TypeScript, ESM.

**Spec:** `docs/superpowers/specs/2026-07-29-exposure-tracking-map-design.md` — read it before starting. Every endpoint and field name in this plan was verified live on 2026-07-29.

## Global Constraints

- **Package manager is pnpm.** The repo's `package.json` declares `pnpm ^11.13.0`. Never run `npm install` or `yarn`.
- **ESM only.** `package.json` has `"type": "module"`. No `require()`, no `.cjs`.
- **No API keys anywhere.** No `GOOGLE_MAPS_API_KEY`, no Mapbox token. Census geocoding and OpenFreeMap tiles are both keyless. If a task seems to need a key, it is wrong.
- **Coordinate validation is territory-aware.** Valid means latitude in `[-90, 90]`, longitude in `[-180, 180]`, and not exactly `(0, 0)`. **Never** apply a contiguous-US bounding box — Guam NPL sites sit at longitude `+144.9`, latitude `13.4`, and would be erased.
- **Census returns `coordinates.x` as LONGITUDE and `coordinates.y` as LATITUDE.** This inversion is the easiest bug in the codebase.
- **EPA vocabularies are stored as strings, never Prisma enums.** Unknown values pass through with a `console.warn`, never throwing. Verified values include `Status Unavailable` and `Not a Groundwater Site`, neither of which is documented by EPA.
- **Distance is always straight-line statute miles**, computed by `haversineMiles`. Never kilometres, never driving distance.
- **Radius options are exactly 5, 10, 25, 50, 100 miles**, defaulting to 25.
- **The scrape must stay polite:** strictly sequential, 400 ms delay between requests, descriptive `User-Agent`, at most 2 retries per site.
- **Commit after every task.** Conventional-commit prefixes (`feat:`, `test:`, `chore:`, `fix:`).

## File Structure

| Path | Responsibility |
|---|---|
| `prisma/schema.prisma` | Data model: `Site`, `Contaminant`, `SiteContaminant`, `GeocodeCache`, `IngestRun` |
| `src/lib/server/prisma.ts` | Prisma client singleton for app routes only (not tests) |
| `src/lib/geo/haversine.ts` | `haversineMiles(a, b)` — pure |
| `src/lib/geo/bbox.ts` | `boundingBox(point, miles)` — pure |
| `src/lib/geo/types.ts` | `LatLng` shared type |
| `src/lib/server/ingest/cache.ts` | Read/write raw payloads under `.cache/` |
| `src/lib/server/ingest/normalize.ts` | Envirofacts rows → typed records — pure |
| `src/lib/server/ingest/parseMeasures.ts` | Profile-page HTML → measure map — pure |
| `src/lib/server/ingest/sources/sites.ts` | Fetch `envirofacts_site` for F/D/P |
| `src/lib/server/ingest/sources/contaminants.ts` | Fetch `envirofacts_contaminants`, paginated |
| `src/lib/server/ingest/sources/measures.ts` | Fetch one profile page, rate-limited |
| `src/lib/server/ingest/upsert.ts` | Idempotent writes + `IngestRun` bookkeeping |
| `src/lib/server/proximity.ts` | Rank candidates by distance; radius + nearest-3 fallback |
| `src/lib/server/geocode/index.ts` | `Geocoder` interface + DB-backed cache wrapper |
| `src/lib/server/geocode/census.ts` | Census one-line geocoder |
| `scripts/download.ts` | CLI: `--source`, `--refresh`, `--dry-run`, `--limit` |
| `src/routes/api/sites/+server.ts` | GET all pins as GeoJSON |
| `src/routes/api/sites/[epaId]/+server.ts` | GET one site + contaminants |
| `src/routes/api/search/+server.ts` | POST address + radius → ranked results |
| `src/routes/+page.svelte` | The single page; owns search state |
| `src/lib/components/Map.svelte` | MapLibre wrapper; emits events, no business logic |
| `src/lib/components/AddressSearch.svelte` | Address input + radius select |
| `src/lib/components/ResultsList.svelte` | Ranked results, keyboard navigable |
| `src/lib/components/SiteDialog.svelte` | Per-site detail dialog |
| `src/lib/components/Legend.svelte` | Pin colour key |
| `src/lib/statusColors.ts` | Single source of truth for exposure-status → colour |

---

## Task 1: Project scaffold

**Files:**
- Modify: `package.json`
- Create: `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `.gitignore`, `.env`, `.env.example`, `src/app.html`, `src/app.css`, `src/app.d.ts`, `src/routes/+layout.svelte`, `src/routes/+page.svelte`
- Test: `src/lib/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a working `pnpm dev`, `pnpm test`, `pnpm build`. All later tasks assume Vitest resolves `$lib/*` and that Tailwind classes work.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add @prisma/client maplibre-gl
pnpm add -D @sveltejs/kit @sveltejs/adapter-node @sveltejs/vite-plugin-svelte svelte svelte-check \
  typescript vite vitest @tailwindcss/vite tailwindcss prisma tsx dotenv @playwright/test
```

- [ ] **Step 2: Write `svelte.config.js`**

```js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter() }
};
```

- [ ] **Step 3: Write `vite.config.ts`**

Tailwind v4 is a Vite plugin. It must come before `sveltekit()`.

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'node'
  }
});
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

- [ ] **Step 5: Write `src/app.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%sveltekit.assets%/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 6: Write `src/app.css`, `src/app.d.ts`, and the layout**

`src/app.css` — Tailwind v4 uses a single import, no config file:

```css
@import 'tailwindcss';
@import 'maplibre-gl/dist/maplibre-gl.css';
```

`src/app.d.ts`:

```ts
declare global {
  namespace App {}
}
export {};
```

`src/routes/+layout.svelte`:

```svelte
<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
```

`src/routes/+page.svelte` — placeholder, replaced in Task 14:

```svelte
<h1 class="p-8 text-2xl font-bold">Exposure Tracking Map</h1>
```

- [ ] **Step 7: Write `.gitignore`, `.env`, and `.env.example`**

`.gitignore`:

```
node_modules/
.svelte-kit/
build/
.cache/
prisma/dev.db
prisma/dev.db-journal
test-results/
playwright-report/
.env
```

`.env` and `.env.example` both contain:

```
DATABASE_URL="file:./dev.db"
```

`.env` is gitignored; `.env.example` is committed. The path is relative to `prisma/`, which is how Prisma resolves SQLite URLs.

- [ ] **Step 8: Add scripts to `package.json`**

Merge into the existing `scripts` block, replacing the placeholder `test`:

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "download": "tsx scripts/download.ts"
  }
}
```

- [ ] **Step 9: Write the smoke test**

```ts
// src/lib/smoke.test.ts
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 10: Verify the toolchain**

Run: `pnpm test`
Expected: 1 test passes.

Run: `pnpm build`
Expected: build succeeds, `build/` produced.

If `pnpm build` complains that `.svelte-kit/tsconfig.json` is missing, run `pnpm exec svelte-kit sync` first.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold SvelteKit 2 + Tailwind v4 + Vitest"
```

---

## Task 2: Prisma schema and client

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/server/prisma.ts`
- Test: `src/lib/server/schema.test.ts`

**Interfaces:**
- Consumes: Task 1's toolchain and `DATABASE_URL`.
- Produces: the generated Prisma client with models `Site`, `Contaminant`, `SiteContaminant`, `GeocodeCache`, `IngestRun`, and a default-exported client singleton at `$lib/server/prisma`. Every field name used by later tasks is fixed here.

- [ ] **Step 1: Write `prisma/schema.prisma`**

Field names come straight from the spec's verified-sources section. `semsSiteId` is the Envirofacts `site_id` and is the join key for contaminants and the URL key for the profile scrape.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Site {
  id                    Int     @id @default(autoincrement())
  semsSiteId            String  @unique
  epaId                 String  @unique
  name                  String
  streetAddress         String?
  supplementalAddress   String?
  city                  String?
  county                String?
  state                 String
  zip                   String?
  fipsCode              String?
  congressionalDistrict String?
  epaRegion             String?
  latitude              Float
  longitude             Float
  nplStatusCode         String
  nplStatusName          String
  federalFacility       Boolean @default(false)
  archived              Boolean @default(false)

  humanExposureStatus        String?
  groundwaterMigrationStatus String?
  constructionComplete       String?
  sitewideReadyForUse        String?
  measuresFetchedAt          DateTime?

  profileUrl   String
  contaminants SiteContaminant[]

  @@index([latitude, longitude])
  @@index([state])
}

model Contaminant {
  id    Int               @id @default(autoincrement())
  name  String            @unique
  sites SiteContaminant[]
}

model SiteContaminant {
  site          Site        @relation(fields: [siteId], references: [id], onDelete: Cascade)
  siteId        Int
  contaminant   Contaminant @relation(fields: [contaminantId], references: [id])
  contaminantId Int
  media         String

  @@id([siteId, contaminantId, media])
}

model GeocodeCache {
  normalizedQuery String   @id
  latitude        Float
  longitude       Float
  matchedAddress  String
  provider        String
  createdAt       DateTime @default(now())
}

model IngestRun {
  id              Int       @id @default(autoincrement())
  source          String
  startedAt       DateTime  @default(now())
  finishedAt      DateTime?
  recordsUpserted Int       @default(0)
  recordsRejected Int       @default(0)
  status          String
  error           String?
}
```

- [ ] **Step 2: Create the migration**

Run: `pnpm exec prisma migrate dev --name init`
Expected: `prisma/migrations/*_init/migration.sql` created, `prisma/dev.db` created, client generated.

- [ ] **Step 3: Write the failing schema test**

This asserts the client exposes every model later tasks depend on, and that a `Site` round-trips. It uses its own client against a temp file — never the app singleton.

```ts
// src/lib/server/schema.test.ts
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let prisma: PrismaClient;
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'etm-schema-'));
  const url = `file:${join(dir, 'test.db')}`;
  execSync('pnpm exec prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url } });
  prisma = new PrismaClient({ datasources: { db: { url } } });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe('schema', () => {
  it('round-trips a site with a Guam coordinate', async () => {
    const site = await prisma.site.create({
      data: {
        semsSiteId: '0900001',
        epaId: 'GUD000000001',
        name: 'TEST GUAM SITE',
        state: 'GU',
        latitude: 13.439169,
        longitude: 144.897361,
        nplStatusCode: 'F',
        nplStatusName: 'Currently on the Final NPL',
        profileUrl: 'https://example.invalid/site'
      }
    });
    expect(site.longitude).toBeGreaterThan(0);
    expect(site.humanExposureStatus).toBeNull();
  });

  it('deduplicates site-contaminant-media triples', async () => {
    const site = await prisma.site.create({
      data: {
        semsSiteId: '0100041',
        epaId: 'CTD001153923',
        name: 'LINEMASTER SWITCH CORP.',
        state: 'CT',
        latitude: 41.940561,
        longitude: -71.966939,
        nplStatusCode: 'F',
        nplStatusName: 'Currently on the Final NPL',
        profileUrl: 'https://example.invalid/site2'
      }
    });
    const c = await prisma.contaminant.create({ data: { name: 'TRICHLOROETHENE' } });
    await prisma.siteContaminant.create({
      data: { siteId: site.id, contaminantId: c.id, media: 'Groundwater' }
    });
    await expect(
      prisma.siteContaminant.create({
        data: { siteId: site.id, contaminantId: c.id, media: 'Groundwater' }
      })
    ).rejects.toThrow();

    // Same contaminant in a different medium is a distinct, allowed row.
    const second = await prisma.siteContaminant.create({
      data: { siteId: site.id, contaminantId: c.id, media: 'Soil' }
    });
    expect(second.media).toBe('Soil');
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm test src/lib/server/schema.test.ts`
Expected: PASS. If the migration step fails, confirm `.env` holds `DATABASE_URL="file:./dev.db"`.

- [ ] **Step 5: Write the client singleton**

`$env/dynamic/private` is used so the URL is read at runtime, not baked in at build. This file is imported only by route handlers — never by tests or pure modules, because importing `$env/*` outside a SvelteKit context throws.

```ts
// src/lib/server/prisma.ts
import { PrismaClient } from '@prisma/client';
import { env } from '$env/dynamic/private';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(env.DATABASE_URL ? { datasources: { db: { url: env.DATABASE_URL } } } : {});

if (!globalForPrisma.prisma) globalForPrisma.prisma = prisma;
```

The singleton guard prevents Vite's dev-mode module reloading from opening a new connection pool on every edit.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema for sites, contaminants, and ingest runs"
```

---

## Task 3: Haversine distance

**Files:**
- Create: `src/lib/geo/types.ts`, `src/lib/geo/haversine.ts`
- Test: `src/lib/geo/haversine.test.ts`

**Interfaces:**
- Consumes: nothing. Pure module, no imports beyond its own types.
- Produces:
  - `type LatLng = { latitude: number; longitude: number }`
  - `haversineMiles(a: LatLng, b: LatLng): number` — statute miles, always non-negative.

- [ ] **Step 1: Write the failing test**

Expected values are computed from the haversine formula on a spherical Earth of mean radius 3958.7613 miles. Tolerances are loose enough to survive floating-point differences but tight enough to catch a radians/degrees mix-up or a swapped argument.

```ts
// src/lib/geo/haversine.test.ts
import { describe, expect, it } from 'vitest';
import { haversineMiles } from './haversine';

const WHITE_HOUSE = { latitude: 38.898699, longitude: -77.035188 };
const LINEMASTER = { latitude: 41.940561, longitude: -71.966939 };
const GUAM = { latitude: 13.439169, longitude: 144.897361 };
const ANCHORAGE = { latitude: 61.2181, longitude: -149.9003 };

describe('haversineMiles', () => {
  it('returns zero for identical points', () => {
    expect(haversineMiles(WHITE_HOUSE, WHITE_HOUSE)).toBe(0);
  });

  it('measures a known east-coast pair', () => {
    // White House to the Linemaster Switch Superfund site, ~339 mi.
    expect(haversineMiles(WHITE_HOUSE, LINEMASTER)).toBeCloseTo(339, 0);
  });

  it('is symmetric', () => {
    expect(haversineMiles(WHITE_HOUSE, LINEMASTER)).toBeCloseTo(
      haversineMiles(LINEMASTER, WHITE_HOUSE),
      6
    );
  });

  it('handles a positive-longitude territory across the antimeridian', () => {
    // Anchorage to Guam, ~4900 mi. A naive implementation that assumes
    // negative longitudes or forgets to wrap will be wildly off.
    const d = haversineMiles(ANCHORAGE, GUAM);
    expect(d).toBeGreaterThan(4500);
    expect(d).toBeLessThan(5300);
  });

  it('never returns a negative distance', () => {
    expect(haversineMiles(GUAM, ANCHORAGE)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/geo/haversine.test.ts`
Expected: FAIL — cannot resolve `./haversine`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/geo/types.ts
export type LatLng = { latitude: number; longitude: number };
```

```ts
// src/lib/geo/haversine.ts
import type { LatLng } from './types';

/** Mean Earth radius in statute miles. */
export const EARTH_RADIUS_MILES = 3958.7613;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two points in statute miles.
 *
 * Correct for any valid coordinate pair, including positive longitudes
 * (Guam) and paths crossing the antimeridian — the cosine of the longitude
 * delta makes wrapping automatic.
 */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}
```

`Math.min(1, ...)` guards against floating-point values slightly above 1 for antipodal points, which would make `asin` return `NaN`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/geo/haversine.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo/
git commit -m "feat: add haversine distance in statute miles"
```

---

## Task 4: Bounding box for radius prefilter

**Files:**
- Create: `src/lib/geo/bbox.ts`
- Test: `src/lib/geo/bbox.test.ts`

**Interfaces:**
- Consumes: `LatLng` from `$lib/geo/types`.
- Produces: `boundingBox(center: LatLng, miles: number): BBox` where
  `type BBox = { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number; wrapsAntimeridian: boolean }`.
  Task 12's search route uses this to build the Prisma `where` clause.

**Why this needs care:** a degree of longitude shrinks as latitude rises. At Anchorage's latitude a 25-mile box spans roughly twice the longitude of the same box in Florida. Using a fixed degrees-per-mile constant for longitude would under-select candidates in Alaska and silently drop real results.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/geo/bbox.test.ts
import { describe, expect, it } from 'vitest';
import { boundingBox } from './bbox';
import { haversineMiles } from './haversine';

const MIAMI = { latitude: 25.7617, longitude: -80.1918 };
const ANCHORAGE = { latitude: 61.2181, longitude: -149.9003 };
const NEAR_ANTIMERIDIAN = { latitude: 52.0, longitude: 179.9 };

describe('boundingBox', () => {
  it('produces a box that fully contains the radius circle', () => {
    const box = boundingBox(MIAMI, 25);
    // A point due north at exactly the radius must be inside the box.
    const north = { latitude: MIAMI.latitude + 25 / 69, longitude: MIAMI.longitude };
    expect(haversineMiles(MIAMI, north)).toBeCloseTo(25, 0);
    expect(north.latitude).toBeLessThanOrEqual(box.maxLatitude);
  });

  it('widens longitude span at high latitude', () => {
    const miamiSpan =
      boundingBox(MIAMI, 25).maxLongitude - boundingBox(MIAMI, 25).minLongitude;
    const anchorageSpan =
      boundingBox(ANCHORAGE, 25).maxLongitude - boundingBox(ANCHORAGE, 25).minLongitude;
    expect(anchorageSpan).toBeGreaterThan(miamiSpan * 1.5);
  });

  it('clamps latitude to the poles', () => {
    const box = boundingBox({ latitude: 89.5, longitude: 0 }, 200);
    expect(box.maxLatitude).toBeLessThanOrEqual(90);
    expect(box.minLatitude).toBeGreaterThanOrEqual(-90);
  });

  it('flags a box that wraps the antimeridian', () => {
    const box = boundingBox(NEAR_ANTIMERIDIAN, 100);
    expect(box.wrapsAntimeridian).toBe(true);
    expect(box.minLongitude).toBeGreaterThan(box.maxLongitude);
  });

  it('does not flag ordinary boxes', () => {
    expect(boundingBox(MIAMI, 25).wrapsAntimeridian).toBe(false);
  });

  it('degenerates safely at zero radius', () => {
    const box = boundingBox(MIAMI, 0);
    expect(box.minLatitude).toBeCloseTo(MIAMI.latitude, 6);
    expect(box.maxLatitude).toBeCloseTo(MIAMI.latitude, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/geo/bbox.test.ts`
Expected: FAIL — cannot resolve `./bbox`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/geo/bbox.ts
import type { LatLng } from './types';

export type BBox = {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
  /** True when the box crosses ±180°, so min > max and the query needs an OR. */
  wrapsAntimeridian: boolean;
};

/**
 * Fraction of extra margin applied to the box. The box must never under-select --
 * callers apply an exact haversine test afterwards, so over-selecting costs a few
 * wasted comparisons while under-selecting silently drops real search results.
 */
const SAFETY_FACTOR = 1.001;

/** Derived from the shared Earth radius so bbox and haversine cannot drift apart. */
const degreesPerMileLatitude = 180 / (Math.PI * EARTH_RADIUS_MILES);

/**
 * Smallest lat/lng box guaranteed to contain every point within `miles` of
 * `center`. Used only as a cheap indexed prefilter — callers still apply an
 * exact haversine check, so the box may over-select but must never under-select.
 */
export function boundingBox(center: LatLng, miles: number): BBox {
  const latDelta = miles / MILES_PER_DEGREE_LAT;

  const minLatitude = Math.max(-90, center.latitude - latDelta);
  const maxLatitude = Math.min(90, center.latitude + latDelta);

  // A degree of longitude narrows by cos(latitude). Use the latitude of the
  // box edge nearest a pole, where degrees are widest, so the box never
  // under-selects. Clamp the cosine to avoid a division blow-up at the poles.
  const widestLatitude = Math.max(Math.abs(minLatitude), Math.abs(maxLatitude));
  const cos = Math.max(Math.cos((widestLatitude * Math.PI) / 180), 1e-6);
  const lonDelta = Math.min(180, latDelta / cos);

  const rawMin = center.longitude - lonDelta;
  const rawMax = center.longitude + lonDelta;
  const wrapsAntimeridian = rawMin < -180 || rawMax > 180;

  const wrap = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

  return {
    minLatitude,
    maxLatitude,
    minLongitude: wrapsAntimeridian ? wrap(rawMin) : rawMin,
    maxLongitude: wrapsAntimeridian ? wrap(rawMax) : rawMax,
    wrapsAntimeridian
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/geo/bbox.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo/
git commit -m "feat: add latitude-aware bounding box for radius prefilter"
```

---

## Task 5: Raw cache and site normalization

**Files:**
- Create: `src/lib/server/ingest/cache.ts`, `src/lib/server/ingest/normalize.ts`
- Test: `src/lib/server/ingest/cache.test.ts`, `src/lib/server/ingest/normalize.test.ts`

**Interfaces:**
- Consumes: nothing (both modules are pure or filesystem-only; neither imports Prisma or `$env`).
- Produces:
  - `readCache<T>(key: string, maxAgeMs?: number): T | null`
  - `writeCache(key: string, value: unknown): void`
  - `cachePath(key: string): string`
  - `type RawSiteRow` — the Envirofacts `envirofacts_site` shape
  - `type SiteRecord` — the normalized shape consumed by Task 6's upsert
  - `normalizeSites(rows: RawSiteRow[]): { records: SiteRecord[]; rejected: RejectedRow[] }`
  - `isValidCoordinate(lat: number, lon: number): boolean`
  - `profileUrlFor(semsSiteId: string): string`

- [ ] **Step 1: Write the failing cache test**

```ts
// src/lib/server/ingest/cache.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCache, writeCache } from './cache';

let dir: string;
const original = process.env.ETM_CACHE_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'etm-cache-'));
  process.env.ETM_CACHE_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (original === undefined) delete process.env.ETM_CACHE_DIR;
  else process.env.ETM_CACHE_DIR = original;
});

describe('cache', () => {
  it('returns null for a missing key', () => {
    expect(readCache('nope')).toBeNull();
  });

  it('round-trips a value', () => {
    writeCache('sites-F', [{ site_id: '0100041' }]);
    expect(readCache<{ site_id: string }[]>('sites-F')).toEqual([{ site_id: '0100041' }]);
  });

  it('treats an entry older than maxAge as absent', () => {
    writeCache('stale', { a: 1 });
    expect(readCache('stale', -1)).toBeNull();
  });

  it('sanitizes keys so they cannot escape the cache directory', () => {
    writeCache('../../escape', { a: 1 });
    expect(readCache('../../escape')).toEqual({ a: 1 });
    // The traversal was neutralized, not honoured.
    expect(readCache('escape')).toBeNull();
  });

  it('returns null rather than throwing on corrupt JSON', () => {
    writeCache('corrupt', { a: 1 });
    const { writeFileSync } = require('node:fs');
    writeFileSync(join(dir, 'corrupt.json'), '{not json');
    expect(readCache('corrupt')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/lib/server/ingest/cache.test.ts`
Expected: FAIL — cannot resolve `./cache`.

- [ ] **Step 3: Implement the cache**

```ts
// src/lib/server/ingest/cache.ts
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function cacheDir(): string {
  const dir = process.env.ETM_CACHE_DIR ?? '.cache';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Collapse anything path-like so a key can never escape the cache directory. */
const safeKey = (key: string): string => key.replace(/[^a-zA-Z0-9._-]/g, '_');

export function cachePath(key: string): string {
  return join(cacheDir(), `${safeKey(key)}.json`);
}

export function writeCache(key: string, value: unknown): void {
  writeFileSync(cachePath(key), JSON.stringify(value), 'utf8');
}

/**
 * Read a cached payload, or null if absent, older than `maxAgeMs`, or corrupt.
 * Never throws — a bad cache entry must degrade to a refetch, not a crash.
 */
export function readCache<T>(key: string, maxAgeMs: number = DEFAULT_MAX_AGE_MS): T | null {
  const path = cachePath(key);
  if (!existsSync(path)) return null;
  if (Date.now() - statSync(path).mtimeMs > maxAgeMs) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    console.warn(`[cache] discarding corrupt entry: ${path}`);
    return null;
  }
}
```

- [ ] **Step 4: Run the cache test to verify it passes**

Run: `pnpm test src/lib/server/ingest/cache.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Write the failing normalize test**

The fixture rows are real, captured from the live API. Note the Guam row — this test is the guard against a contiguous-US bounding box being reintroduced.

```ts
// src/lib/server/ingest/normalize.test.ts
import { describe, expect, it } from 'vitest';
import { isValidCoordinate, normalizeSites, profileUrlFor, type RawSiteRow } from './normalize';

const LINEMASTER: RawSiteRow = {
  site_id: '0100041',
  fk_ref_region_code: '01',
  name: 'LINEMASTER SWITCH CORP.',
  epa_id: 'CTD001153923',
  street_addr_txt: '29 PLAINE HILL ROAD',
  supplemental_addr_txt: null,
  city_name: 'WOODSTOCK',
  fk_ref_state_code: 'CT',
  zip_code: '06281',
  congressional_district_code: '02',
  county_name: 'WINDHAM',
  fips_code: '09015',
  primary_latitude_decimal_val: '41.940561',
  primary_longitude_decimal_val: '-71.966939',
  npl_status_code: 'F',
  npl_status_name: 'Currently on the Final NPL',
  federal_facility_ind: 'N',
  archived_ind: 'N'
};

const GUAM: RawSiteRow = {
  ...LINEMASTER,
  site_id: '0900001',
  epa_id: 'GUD980637649',
  name: 'ORDOT LANDFILL',
  fk_ref_state_code: 'GU',
  primary_latitude_decimal_val: '13.439169',
  primary_longitude_decimal_val: '144.897361',
  federal_facility_ind: 'Y'
};

describe('isValidCoordinate', () => {
  it('accepts a positive-longitude territory', () => {
    expect(isValidCoordinate(13.439169, 144.897361)).toBe(true);
  });

  it('accepts Alaska', () => {
    expect(isValidCoordinate(64.823, -147.6)).toBe(true);
  });

  it('rejects null island', () => {
    expect(isValidCoordinate(0, 0)).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 10)).toBe(false);
  });
});

describe('profileUrlFor', () => {
  it('builds the Healthenv-sibling cleanup profile URL', () => {
    expect(profileUrlFor('0100041')).toContain('id=0100041');
    expect(profileUrlFor('0100041')).toContain('cumulis.epa.gov');
  });
});

describe('normalizeSites', () => {
  it('maps Envirofacts field names to the schema', () => {
    const { records, rejected } = normalizeSites([LINEMASTER]);
    expect(rejected).toHaveLength(0);
    expect(records[0]).toMatchObject({
      semsSiteId: '0100041',
      epaId: 'CTD001153923',
      name: 'LINEMASTER SWITCH CORP.',
      streetAddress: '29 PLAINE HILL ROAD',
      city: 'WOODSTOCK',
      county: 'WINDHAM',
      state: 'CT',
      zip: '06281',
      epaRegion: '01',
      latitude: 41.940561,
      longitude: -71.966939,
      nplStatusCode: 'F',
      federalFacility: false,
      archived: false
    });
  });

  it('preserves Guam coordinates', () => {
    const { records, rejected } = normalizeSites([GUAM]);
    expect(rejected).toHaveLength(0);
    expect(records[0].longitude).toBeCloseTo(144.897361, 6);
    expect(records[0].federalFacility).toBe(true);
  });

  it('rejects rows with missing coordinates and reports why', () => {
    const bad = { ...LINEMASTER, primary_latitude_decimal_val: null };
    const { records, rejected } = normalizeSites([bad]);
    expect(records).toHaveLength(0);
    expect(rejected).toEqual([{ semsSiteId: '0100041', reason: 'invalid-coordinate' }]);
  });

  it('rejects rows missing an identifier', () => {
    const bad = { ...LINEMASTER, epa_id: null };
    const { rejected } = normalizeSites([bad]);
    expect(rejected[0].reason).toBe('missing-identifier');
  });

  it('normalizes empty strings to null', () => {
    const { records } = normalizeSites([{ ...LINEMASTER, zip_code: '   ' }]);
    expect(records[0].zip).toBeNull();
  });

  it('deduplicates repeated semsSiteId, keeping the first', () => {
    const { records } = normalizeSites([LINEMASTER, { ...LINEMASTER, name: 'DUPLICATE' }]);
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('LINEMASTER SWITCH CORP.');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm test src/lib/server/ingest/normalize.test.ts`
Expected: FAIL — cannot resolve `./normalize`.

- [ ] **Step 7: Implement normalize**

```ts
// src/lib/server/ingest/normalize.ts

/** A row exactly as Envirofacts `envirofacts_site` returns it. */
export type RawSiteRow = {
  site_id?: string | null;
  fk_ref_region_code?: string | null;
  name?: string | null;
  epa_id?: string | null;
  street_addr_txt?: string | null;
  supplemental_addr_txt?: string | null;
  city_name?: string | null;
  fk_ref_state_code?: string | null;
  zip_code?: string | null;
  congressional_district_code?: string | null;
  county_name?: string | null;
  fips_code?: string | null;
  primary_latitude_decimal_val?: string | number | null;
  primary_longitude_decimal_val?: string | number | null;
  npl_status_code?: string | null;
  npl_status_name?: string | null;
  federal_facility_ind?: string | null;
  archived_ind?: string | null;
};

export type SiteRecord = {
  semsSiteId: string;
  epaId: string;
  name: string;
  streetAddress: string | null;
  supplementalAddress: string | null;
  city: string | null;
  county: string | null;
  state: string;
  zip: string | null;
  fipsCode: string | null;
  congressionalDistrict: string | null;
  epaRegion: string | null;
  latitude: number;
  longitude: number;
  nplStatusCode: string;
  nplStatusName: string;
  federalFacility: boolean;
  archived: boolean;
  profileUrl: string;
};

export type RejectedRow = {
  semsSiteId: string;
  reason: 'missing-identifier' | 'invalid-coordinate';
};

const PROFILE_BASE =
  'https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm?fuseaction=second.cleanup&id=';

export function profileUrlFor(semsSiteId: string): string {
  return `${PROFILE_BASE}${semsSiteId}`;
}

/**
 * Coordinate sanity check. Deliberately NOT a contiguous-US bounding box:
 * Guam NPL sites have positive longitudes (+144.9) and would be erased.
 */
export function isValidCoordinate(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lon < -180 || lon > 180) return false;
  if (lat === 0 && lon === 0) return false;
  return true;
}

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const number = (v: unknown): number => {
  const s = text(v);
  return s === null ? Number.NaN : Number(s);
};

const isYes = (v: unknown): boolean => text(v)?.toUpperCase() === 'Y';

export function normalizeSites(rows: RawSiteRow[]): {
  records: SiteRecord[];
  rejected: RejectedRow[];
} {
  const records: SiteRecord[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const semsSiteId = text(row.site_id);
    const epaId = text(row.epa_id);
    const name = text(row.name);
    const state = text(row.fk_ref_state_code);

    if (!semsSiteId || !epaId || !name || !state) {
      rejected.push({ semsSiteId: semsSiteId ?? '(unknown)', reason: 'missing-identifier' });
      continue;
    }
    if (seen.has(semsSiteId)) continue;

    const latitude = number(row.primary_latitude_decimal_val);
    const longitude = number(row.primary_longitude_decimal_val);
    if (!isValidCoordinate(latitude, longitude)) {
      rejected.push({ semsSiteId, reason: 'invalid-coordinate' });
      continue;
    }

    seen.add(semsSiteId);
    records.push({
      semsSiteId,
      epaId,
      name,
      streetAddress: text(row.street_addr_txt),
      supplementalAddress: text(row.supplemental_addr_txt),
      city: text(row.city_name),
      county: text(row.county_name),
      state,
      zip: text(row.zip_code),
      fipsCode: text(row.fips_code),
      congressionalDistrict: text(row.congressional_district_code),
      epaRegion: text(row.fk_ref_region_code),
      latitude,
      longitude,
      nplStatusCode: text(row.npl_status_code) ?? 'F',
      nplStatusName: text(row.npl_status_name) ?? 'Unknown',
      federalFacility: isYes(row.federal_facility_ind),
      archived: isYes(row.archived_ind),
      profileUrl: profileUrlFor(semsSiteId)
    });
  }

  return { records, rejected };
}
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `pnpm test src/lib/server/ingest/`
Expected: all cache and normalize tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/server/ingest/
git commit -m "feat: add raw payload cache and territory-aware site normalization"
```

---

## Task 6: Sites source, upsert, and the download CLI

**Files:**
- Create: `src/lib/server/ingest/sources/sites.ts`, `src/lib/server/ingest/upsert.ts`, `scripts/download.ts`
- Test: `src/lib/server/ingest/sources/sites.test.ts`, `src/lib/server/ingest/upsert.test.ts`

**Interfaces:**
- Consumes: `readCache`/`writeCache` from `./cache`, `normalizeSites`/`SiteRecord`/`RejectedRow` from `./normalize`.
- Produces:
  - `NPL_STATUS_CODES = ['F', 'D', 'P'] as const`
  - `fetchSiteRows(opts?: { refresh?: boolean; fetchImpl?: typeof fetch }): Promise<RawSiteRow[]>`
  - `upsertSites(prisma: PrismaClient, records: SiteRecord[]): Promise<number>`
  - `withIngestRun<T>(prisma, source, fn): Promise<T>` — used by Tasks 7 and 9 too
  - `pnpm download` CLI

- [ ] **Step 1: Write the failing sites-source test**

`fetch` is injected rather than globally mocked so the test never touches the network.

```ts
// src/lib/server/ingest/sources/sites.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSiteRows, NPL_STATUS_CODES } from './sites';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'etm-sites-'));
  process.env.ETM_CACHE_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.ETM_CACHE_DIR;
});

const row = (id: string, code: string) => ({ site_id: id, epa_id: `E${id}`, npl_status_code: code });

describe('fetchSiteRows', () => {
  it('requests every NPL status code and concatenates the results', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      seen.push(u);
      const code = u.match(/npl_status_code\/([FDP])\//)![1];
      return new Response(JSON.stringify([row(`00${code}`, code)]), { status: 200 });
    }) as unknown as typeof fetch;

    const rows = await fetchSiteRows({ fetchImpl });

    expect(seen).toHaveLength(NPL_STATUS_CODES.length);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.npl_status_code).sort()).toEqual(['D', 'F', 'P']);
  });

  it('serves a second call from cache without refetching', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([row('0100041', 'F')]), { status: 200 })
    ) as unknown as typeof fetch;

    await fetchSiteRows({ fetchImpl });
    const callsAfterFirst = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await fetchSiteRows({ fetchImpl });

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsAfterFirst
    );
  });

  it('refetches when refresh is set', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([row('0100041', 'F')]), { status: 200 })
    ) as unknown as typeof fetch;

    await fetchSiteRows({ fetchImpl });
    await fetchSiteRows({ fetchImpl, refresh: true });

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      NPL_STATUS_CODES.length * 2
    );
  });

  it('throws with the status code on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchSiteRows({ fetchImpl })).rejects.toThrow(/503/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/lib/server/ingest/sources/sites.test.ts`
Expected: FAIL — cannot resolve `./sites`.

- [ ] **Step 3: Implement the sites source**

```ts
// src/lib/server/ingest/sources/sites.ts
import { readCache, writeCache } from '../cache';
import type { RawSiteRow } from '../normalize';

const BASE = 'https://data.epa.gov/efservice/envirofacts_site';

/** F = Currently on the Final NPL, D = Deleted, P = Proposed. */
export const NPL_STATUS_CODES = ['F', 'D', 'P'] as const;

export const USER_AGENT =
  'exposure-tracking-map/1.0 (research project; contact: 423821+quinnjr@users.noreply.github.com)';

export type FetchOptions = { refresh?: boolean; fetchImpl?: typeof fetch };

/**
 * All 1,840 NPL sites. Each status code returns its full result set in one
 * request — verified against the live API — so no pagination is needed.
 */
export async function fetchSiteRows(opts: FetchOptions = {}): Promise<RawSiteRow[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const rows: RawSiteRow[] = [];

  for (const code of NPL_STATUS_CODES) {
    const key = `sites-${code}`;
    const cached = opts.refresh ? null : readCache<RawSiteRow[]>(key);
    if (cached) {
      rows.push(...cached);
      continue;
    }

    const url = `${BASE}/npl_status_code/${code}/JSON`;
    const res = await doFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Envirofacts sites request failed: ${res.status} ${url}`);

    const page = (await res.json()) as RawSiteRow[];
    writeCache(key, page);
    rows.push(...page);
  }

  return rows;
}
```

- [ ] **Step 4: Run the sites-source test to verify it passes**

Run: `pnpm test src/lib/server/ingest/sources/sites.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Write the failing upsert test**

```ts
// src/lib/server/ingest/upsert.test.ts
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SiteRecord } from './normalize';
import { upsertSites, withIngestRun } from './upsert';

let prisma: PrismaClient;
let dir: string;

const site = (over: Partial<SiteRecord> = {}): SiteRecord => ({
  semsSiteId: '0100041',
  epaId: 'CTD001153923',
  name: 'LINEMASTER SWITCH CORP.',
  streetAddress: '29 PLAINE HILL ROAD',
  supplementalAddress: null,
  city: 'WOODSTOCK',
  county: 'WINDHAM',
  state: 'CT',
  zip: '06281',
  fipsCode: '09015',
  congressionalDistrict: '02',
  epaRegion: '01',
  latitude: 41.940561,
  longitude: -71.966939,
  nplStatusCode: 'F',
  nplStatusName: 'Currently on the Final NPL',
  federalFacility: false,
  archived: false,
  profileUrl: 'https://example.invalid/p',
  ...over
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'etm-upsert-'));
  const url = `file:${join(dir, 'test.db')}`;
  execSync('pnpm exec prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url } });
  prisma = new PrismaClient({ datasources: { db: { url } } });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.siteContaminant.deleteMany();
  await prisma.contaminant.deleteMany();
  await prisma.site.deleteMany();
  await prisma.ingestRun.deleteMany();
});

describe('upsertSites', () => {
  it('inserts new sites', async () => {
    expect(await upsertSites(prisma, [site()])).toBe(1);
    expect(await prisma.site.count()).toBe(1);
  });

  it('is idempotent — running twice creates no duplicates', async () => {
    await upsertSites(prisma, [site()]);
    await upsertSites(prisma, [site()]);
    expect(await prisma.site.count()).toBe(1);
  });

  it('updates changed fields in place', async () => {
    await upsertSites(prisma, [site()]);
    await upsertSites(prisma, [site({ name: 'RENAMED SITE' })]);
    const row = await prisma.site.findUniqueOrThrow({ where: { semsSiteId: '0100041' } });
    expect(row.name).toBe('RENAMED SITE');
    expect(await prisma.site.count()).toBe(1);
  });

  it('never clobbers scraped measures, which come from a different source', async () => {
    await upsertSites(prisma, [site()]);
    await prisma.site.update({
      where: { semsSiteId: '0100041' },
      data: { humanExposureStatus: 'Yes' }
    });
    await upsertSites(prisma, [site({ name: 'AGAIN' })]);
    const row = await prisma.site.findUniqueOrThrow({ where: { semsSiteId: '0100041' } });
    expect(row.humanExposureStatus).toBe('Yes');
  });
});

describe('withIngestRun', () => {
  it('records a successful run', async () => {
    const result = await withIngestRun(prisma, 'sites', async () => ({
      upserted: 7,
      rejected: 2,
      value: 'ok'
    }));
    expect(result).toBe('ok');
    const run = await prisma.ingestRun.findFirstOrThrow();
    expect(run).toMatchObject({
      source: 'sites',
      status: 'success',
      recordsUpserted: 7,
      recordsRejected: 2
    });
    expect(run.finishedAt).not.toBeNull();
  });

  it('records a failed run and rethrows', async () => {
    await expect(
      withIngestRun(prisma, 'measures', async () => {
        throw new Error('upstream exploded');
      })
    ).rejects.toThrow('upstream exploded');

    const run = await prisma.ingestRun.findFirstOrThrow();
    expect(run.status).toBe('failed');
    expect(run.error).toContain('upstream exploded');
    expect(run.finishedAt).not.toBeNull();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm test src/lib/server/ingest/upsert.test.ts`
Expected: FAIL — cannot resolve `./upsert`.

- [ ] **Step 7: Implement upsert and the ingest-run wrapper**

```ts
// src/lib/server/ingest/upsert.ts
import type { PrismaClient } from '@prisma/client';
import type { SiteRecord } from './normalize';

/**
 * Insert or update sites keyed on semsSiteId. Only fields owned by the
 * Envirofacts sites feed are written, so a re-run never clobbers the
 * performance measures written by the scrape.
 */
export async function upsertSites(
  prisma: PrismaClient,
  records: SiteRecord[]
): Promise<number> {
  let count = 0;
  for (const r of records) {
    await prisma.site.upsert({
      where: { semsSiteId: r.semsSiteId },
      create: r,
      update: r
    });
    count += 1;
  }
  return count;
}

export type IngestOutcome<T> = { upserted: number; rejected: number; value: T };

/**
 * Wrap one ingest source in an IngestRun audit row. A thrown error is
 * recorded and rethrown, so a failing source marks only its own run failed
 * and leaves data from other sources intact.
 */
export async function withIngestRun<T>(
  prisma: PrismaClient,
  source: string,
  fn: () => Promise<IngestOutcome<T>>
): Promise<T> {
  const run = await prisma.ingestRun.create({ data: { source, status: 'running' } });
  try {
    const { upserted, rejected, value } = await fn();
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        status: 'success',
        finishedAt: new Date(),
        recordsUpserted: upserted,
        recordsRejected: rejected
      }
    });
    return value;
  } catch (err) {
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
      }
    });
    throw err;
  }
}
```

- [ ] **Step 8: Run the upsert test to verify it passes**

Run: `pnpm test src/lib/server/ingest/upsert.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 9: Write the download CLI, sites source only**

Tasks 7 and 9 extend this file. It imports `dotenv/config` because `@prisma/client` does not read `.env` on its own outside the Prisma CLI, and it builds its own client rather than importing `$lib/server/prisma`, which depends on a SvelteKit runtime.

```ts
// scripts/download.ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { normalizeSites } from '../src/lib/server/ingest/normalize';
import { fetchSiteRows } from '../src/lib/server/ingest/sources/sites';
import { upsertSites, withIngestRun } from '../src/lib/server/ingest/upsert';

type Args = {
  refresh: boolean;
  dryRun: boolean;
  sources: string[];
  limit: number | null;
};

const ALL_SOURCES = ['sites', 'contaminants', 'measures'] as const;

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

  const source = get('source');
  const limit = get('limit');

  if (source && !ALL_SOURCES.includes(source as (typeof ALL_SOURCES)[number])) {
    throw new Error(`--source must be one of ${ALL_SOURCES.join(', ')}`);
  }

  return {
    refresh: argv.includes('--refresh'),
    dryRun: argv.includes('--dry-run'),
    sources: source ? [source] : [...ALL_SOURCES],
    limit: limit ? Number(limit) : null
  };
}

async function ingestSites(prisma: PrismaClient, args: Args): Promise<void> {
  const rows = await fetchSiteRows({ refresh: args.refresh });
  const { records, rejected } = normalizeSites(rows);

  console.log(`[sites] fetched ${rows.length} rows -> ${records.length} valid, ${rejected.length} rejected`);
  for (const r of rejected) console.warn(`[sites] rejected ${r.semsSiteId}: ${r.reason}`);

  if (args.dryRun) {
    console.log('[sites] dry run — nothing written');
    return;
  }

  await withIngestRun(prisma, 'sites', async () => {
    const upserted = await upsertSites(prisma, records);
    console.log(`[sites] upserted ${upserted}`);
    return { upserted, rejected: rejected.length, value: undefined };
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    if (args.sources.includes('sites')) await ingestSites(prisma, args);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 10: Run the CLI against the live API**

Run: `pnpm download --source=sites`
Expected: `[sites] fetched 1840 rows -> 1840 valid, 0 rejected`, then `[sites] upserted 1840`.

A non-zero rejection count means upstream data changed — investigate before continuing.

Run it a second time and confirm the count stays 1,840:

```bash
pnpm download --source=sites
pnpm exec prisma studio  # optional visual check; Ctrl-C to exit
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: ingest 1,840 NPL sites from EPA Envirofacts"
```

---

## Task 7: Contaminants of concern

**Files:**
- Create: `src/lib/server/ingest/sources/contaminants.ts`
- Modify: `src/lib/server/ingest/normalize.ts` (append), `src/lib/server/ingest/upsert.ts` (append), `scripts/download.ts`
- Test: `src/lib/server/ingest/sources/contaminants.test.ts`, `src/lib/server/ingest/contaminants.test.ts`

**Interfaces:**
- Consumes: `readCache`/`writeCache`, `withIngestRun`, `USER_AGENT` from `./sources/sites`.
- Produces:
  - `CONTAMINANT_PAGE_SIZE = 5000`
  - `fetchContaminantRows(opts?: FetchOptions): Promise<RawContaminantRow[]>`
  - `type RawContaminantRow = { fk_site_id, media_name, preferred_contaminant_name, ... }`
  - `type ContaminantRecord = { semsSiteId: string; name: string; media: string }`
  - `normalizeContaminants(rows, knownSiteIds: Set<string>): { records: ContaminantRecord[]; skipped: number }`
  - `upsertContaminants(prisma, records): Promise<number>`

**Why pagination matters here:** this feed has 72,569 rows covering all 55,588 sites, not just NPL ones. Verified working at 5,000 rows per request via `/rows/{start}:{end}/JSON`. Rows for non-NPL sites are filtered out locally, because Envirofacts cannot filter by a list of IDs.

- [ ] **Step 1: Write the failing source test**

```ts
// src/lib/server/ingest/sources/contaminants.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTAMINANT_PAGE_SIZE, fetchContaminantRows } from './contaminants';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'etm-cont-'));
  process.env.ETM_CACHE_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.ETM_CACHE_DIR;
});

const page = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    fk_site_id: '0100041',
    media_name: 'Groundwater',
    preferred_contaminant_name: `CHEM-${i}`
  }));

describe('fetchContaminantRows', () => {
  it('pages until a short page signals the end', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      urls.push(String(url));
      // Full page, full page, then a short page.
      const body = urls.length < 3 ? page(CONTAMINANT_PAGE_SIZE) : page(12);
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const rows = await fetchContaminantRows({ fetchImpl });

    expect(urls).toHaveLength(3);
    expect(rows).toHaveLength(CONTAMINANT_PAGE_SIZE * 2 + 12);
    expect(urls[0]).toContain(`/rows/0:${CONTAMINANT_PAGE_SIZE - 1}/`);
    expect(urls[1]).toContain(`/rows/${CONTAMINANT_PAGE_SIZE}:${CONTAMINANT_PAGE_SIZE * 2 - 1}/`);
  });

  it('stops immediately on an empty first page', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 })
    ) as unknown as typeof fetch;
    expect(await fetchContaminantRows({ fetchImpl })).toEqual([]);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('throws with the status code on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    await expect(fetchContaminantRows({ fetchImpl })).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/lib/server/ingest/sources/contaminants.test.ts`
Expected: FAIL — cannot resolve `./contaminants`.

- [ ] **Step 3: Implement the contaminants source**

```ts
// src/lib/server/ingest/sources/contaminants.ts
import { readCache, writeCache } from '../cache';
import type { RawContaminantRow } from '../normalize';
import { USER_AGENT, type FetchOptions } from './sites';

const BASE = 'https://data.epa.gov/efservice/envirofacts_contaminants';

/** Verified working page size against the live API. */
export const CONTAMINANT_PAGE_SIZE = 5000;

/**
 * All 72,569 contaminant rows, paginated. Covers every SEMS site, not just
 * NPL ones — callers filter to the ingested site set.
 */
export async function fetchContaminantRows(
  opts: FetchOptions = {}
): Promise<RawContaminantRow[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const cacheKey = 'contaminants';

  if (!opts.refresh) {
    const cached = readCache<RawContaminantRow[]>(cacheKey);
    if (cached) return cached;
  }

  const rows: RawContaminantRow[] = [];
  for (let start = 0; ; start += CONTAMINANT_PAGE_SIZE) {
    const end = start + CONTAMINANT_PAGE_SIZE - 1;
    const url = `${BASE}/rows/${start}:${end}/JSON`;
    const res = await doFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      throw new Error(`Envirofacts contaminants request failed: ${res.status} ${url}`);
    }

    const page = (await res.json()) as RawContaminantRow[];
    rows.push(...page);
    console.log(`[contaminants] fetched ${rows.length} rows`);

    // A page shorter than the requested size is the last page.
    if (page.length < CONTAMINANT_PAGE_SIZE) break;
  }

  writeCache(cacheKey, rows);
  return rows;
}
```

- [ ] **Step 4: Run the source test to verify it passes**

Run: `pnpm test src/lib/server/ingest/sources/contaminants.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Write the failing normalize + upsert test**

```ts
// src/lib/server/ingest/contaminants.test.ts
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { normalizeContaminants, type RawContaminantRow } from './normalize';
import { upsertContaminants, upsertSites } from './upsert';

let prisma: PrismaClient;
let dir: string;

const row = (over: Partial<RawContaminantRow> = {}): RawContaminantRow => ({
  fk_site_id: '0100041',
  media_name: 'Groundwater',
  preferred_contaminant_name: '1,1,1-TRICHLOROETHANE',
  ...over
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'etm-cnorm-'));
  const url = `file:${join(dir, 'test.db')}`;
  execSync('pnpm exec prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url } });
  prisma = new PrismaClient({ datasources: { db: { url } } });
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await prisma.siteContaminant.deleteMany();
  await prisma.contaminant.deleteMany();
  await prisma.site.deleteMany();
  await upsertSites(prisma, [
    {
      semsSiteId: '0100041',
      epaId: 'CTD001153923',
      name: 'LINEMASTER SWITCH CORP.',
      streetAddress: null,
      supplementalAddress: null,
      city: 'WOODSTOCK',
      county: 'WINDHAM',
      state: 'CT',
      zip: null,
      fipsCode: null,
      congressionalDistrict: null,
      epaRegion: '01',
      latitude: 41.940561,
      longitude: -71.966939,
      nplStatusCode: 'F',
      nplStatusName: 'Currently on the Final NPL',
      federalFacility: false,
      archived: false,
      profileUrl: 'https://example.invalid/p'
    }
  ]);
});

describe('normalizeContaminants', () => {
  const known = new Set(['0100041']);

  it('maps source fields', () => {
    const { records, skipped } = normalizeContaminants([row()], known);
    expect(skipped).toBe(0);
    expect(records).toEqual([
      { semsSiteId: '0100041', name: '1,1,1-TRICHLOROETHANE', media: 'Groundwater' }
    ]);
  });

  it('skips rows for sites we did not ingest', () => {
    const { records, skipped } = normalizeContaminants([row({ fk_site_id: '9999999' })], known);
    expect(records).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('deduplicates repeated site-contaminant-media triples', () => {
    // The source repeats a contaminant once per decision document.
    const { records } = normalizeContaminants([row(), row(), row()], known);
    expect(records).toHaveLength(1);
  });

  it('keeps the same contaminant in different media as separate records', () => {
    const { records } = normalizeContaminants([row(), row({ media_name: 'Soil' })], known);
    expect(records).toHaveLength(2);
  });

  it('preserves unusual media values verbatim', () => {
    const { records } = normalizeContaminants([row({ media_name: 'Free-phase NAPL' })], known);
    expect(records[0].media).toBe('Free-phase NAPL');
  });

  it('skips rows with no contaminant name', () => {
    const { records, skipped } = normalizeContaminants(
      [row({ preferred_contaminant_name: '  ' })],
      known
    );
    expect(records).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe('upsertContaminants', () => {
  it('creates contaminants and links them to sites', async () => {
    const { records } = normalizeContaminants([row(), row({ media_name: 'Soil' })], new Set(['0100041']));
    expect(await upsertContaminants(prisma, records)).toBe(2);
    expect(await prisma.contaminant.count()).toBe(1);
    expect(await prisma.siteContaminant.count()).toBe(2);
  });

  it('is idempotent', async () => {
    const { records } = normalizeContaminants([row()], new Set(['0100041']));
    await upsertContaminants(prisma, records);
    await upsertContaminants(prisma, records);
    expect(await prisma.siteContaminant.count()).toBe(1);
    expect(await prisma.contaminant.count()).toBe(1);
  });

  it('reuses one Contaminant row across sites', async () => {
    await upsertSites(prisma, [
      {
        semsSiteId: '0100094',
        epaId: 'CTD001186618',
        name: 'RAYMARK INDUSTRIES, INC.',
        streetAddress: null,
        supplementalAddress: null,
        city: 'STRATFORD',
        county: 'FAIRFIELD',
        state: 'CT',
        zip: null,
        fipsCode: null,
        congressionalDistrict: null,
        epaRegion: '01',
        latitude: 41.201278,
        longitude: -73.117222,
        nplStatusCode: 'F',
        nplStatusName: 'Currently on the Final NPL',
        federalFacility: false,
        archived: false,
        profileUrl: 'https://example.invalid/p2'
      }
    ]);
    const { records } = normalizeContaminants(
      [row(), row({ fk_site_id: '0100094' })],
      new Set(['0100041', '0100094'])
    );
    await upsertContaminants(prisma, records);
    expect(await prisma.contaminant.count()).toBe(1);
    expect(await prisma.siteContaminant.count()).toBe(2);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm test src/lib/server/ingest/contaminants.test.ts`
Expected: FAIL — `normalizeContaminants` and `upsertContaminants` are not exported.

- [ ] **Step 7: Append to `normalize.ts`**

Add at the end of the existing file — do not modify what is already there:

```ts
/** A row exactly as Envirofacts `envirofacts_contaminants` returns it. */
export type RawContaminantRow = {
  fk_site_id?: string | null;
  operable_unit_num?: string | null;
  action_name?: string | null;
  type_code?: string | null;
  seq?: number | null;
  media_name?: string | null;
  preferred_contaminant_name?: string | null;
};

export type ContaminantRecord = {
  semsSiteId: string;
  name: string;
  media: string;
};

/**
 * Reduce the contaminants feed to distinct (site, contaminant, medium) triples
 * for sites we actually ingested. The source repeats a contaminant once per
 * decision document and operable unit; that detail is not needed here.
 */
export function normalizeContaminants(
  rows: RawContaminantRow[],
  knownSiteIds: Set<string>
): { records: ContaminantRecord[]; skipped: number } {
  const byKey = new Map<string, ContaminantRecord>();
  let skipped = 0;

  for (const row of rows) {
    const semsSiteId = text(row.fk_site_id);
    const name = text(row.preferred_contaminant_name)?.toUpperCase() ?? null;
    const media = text(row.media_name) ?? 'Other';

    if (!semsSiteId || !name || !knownSiteIds.has(semsSiteId)) {
      skipped += 1;
      continue;
    }

    byKey.set(`${semsSiteId}|${name}|${media}`, { semsSiteId, name, media });
  }

  return { records: [...byKey.values()], skipped };
}
```

`text` is already defined in this file from Task 5 and is reused here.

- [ ] **Step 8: Append to `upsert.ts`**

```ts
/**
 * Link contaminants to sites. Resolves site and contaminant ids up front so
 * the write loop performs no per-row lookups.
 */
export async function upsertContaminants(
  prisma: PrismaClient,
  records: ContaminantRecord[]
): Promise<number> {
  if (records.length === 0) return 0;

  const sites = await prisma.site.findMany({ select: { id: true, semsSiteId: true } });
  const siteIdBySems = new Map(sites.map((s) => [s.semsSiteId, s.id]));

  const names = [...new Set(records.map((r) => r.name))];
  for (const name of names) {
    await prisma.contaminant.upsert({ where: { name }, create: { name }, update: {} });
  }
  const contaminants = await prisma.contaminant.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true }
  });
  const contaminantIdByName = new Map(contaminants.map((c) => [c.name, c.id]));

  let count = 0;
  for (const r of records) {
    const siteId = siteIdBySems.get(r.semsSiteId);
    const contaminantId = contaminantIdByName.get(r.name);
    if (siteId === undefined || contaminantId === undefined) continue;

    await prisma.siteContaminant.upsert({
      where: { siteId_contaminantId_media: { siteId, contaminantId, media: r.media } },
      create: { siteId, contaminantId, media: r.media },
      update: {}
    });
    count += 1;
  }
  return count;
}
```

Also extend the import at the top of `upsert.ts`:

```ts
import type { ContaminantRecord, SiteRecord } from './normalize';
```

The composite-key argument name `siteId_contaminantId_media` is generated by Prisma from the `@@id([siteId, contaminantId, media])` field order. If it does not typecheck, run `pnpm exec prisma generate` and read the generated name.

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm test src/lib/server/ingest/contaminants.test.ts`
Expected: 9 tests PASS.

- [ ] **Step 10: Wire contaminants into the CLI**

Add to `scripts/download.ts`. New imports:

```ts
import { normalizeContaminants, normalizeSites } from '../src/lib/server/ingest/normalize';
import { fetchContaminantRows } from '../src/lib/server/ingest/sources/contaminants';
import { upsertContaminants, upsertSites, withIngestRun } from '../src/lib/server/ingest/upsert';
```

New function:

```ts
async function ingestContaminants(prisma: PrismaClient, args: Args): Promise<void> {
  const sites = await prisma.site.findMany({ select: { semsSiteId: true } });
  if (sites.length === 0) {
    throw new Error('No sites in the database — run `pnpm download --source=sites` first');
  }
  const known = new Set(sites.map((s) => s.semsSiteId));

  const rows = await fetchContaminantRows({ refresh: args.refresh });
  const { records, skipped } = normalizeContaminants(rows, known);
  console.log(
    `[contaminants] ${rows.length} rows -> ${records.length} triples for ${known.size} sites (${skipped} skipped as non-NPL or unnamed)`
  );

  if (args.dryRun) {
    console.log('[contaminants] dry run — nothing written');
    return;
  }

  await withIngestRun(prisma, 'contaminants', async () => {
    const upserted = await upsertContaminants(prisma, records);
    console.log(`[contaminants] upserted ${upserted} links`);
    return { upserted, rejected: skipped, value: undefined };
  });
}
```

Call it in `main`, after sites:

```ts
    if (args.sources.includes('sites')) await ingestSites(prisma, args);
    if (args.sources.includes('contaminants')) await ingestContaminants(prisma, args);
```

- [ ] **Step 11: Run against the live API**

Run: `pnpm download --source=contaminants`
Expected: pages up to ~72,569 rows, then reports a triple count and upserts it. The first run takes a couple of minutes; subsequent runs read from `.cache/contaminants.json`.

Sanity check the result:

```bash
pnpm exec prisma db execute --stdin <<'SQL'
SELECT (SELECT COUNT(*) FROM Contaminant) AS contaminants,
       (SELECT COUNT(*) FROM SiteContaminant) AS links,
       (SELECT COUNT(DISTINCT siteId) FROM SiteContaminant) AS sites_with_data;
SQL
```

Expected: several hundred distinct contaminants, tens of thousands of links, and `sites_with_data` well below 1,840 — coverage is genuinely uneven, which is why the UI must handle sites with none.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: ingest contaminants of concern with paginated Envirofacts fetch"
```

---

## Task 8: Performance-measures parser

**Files:**
- Create: `src/lib/server/ingest/parseMeasures.ts`
- Test: `src/lib/server/ingest/parseMeasures.test.ts`, `src/lib/server/ingest/fixtures/measures-linemaster.html`, `src/lib/server/ingest/fixtures/measures-none.html`

**Interfaces:**
- Consumes: nothing. Pure function, no DOM library — a regex-over-table-structure parser, since the project has no `cheerio` dependency and does not need one.
- Produces:
  - `type MeasureMap = { humanExposureStatus: string | null; groundwaterMigrationStatus: string | null; constructionComplete: string | null; sitewideReadyForUse: string | null }`
  - `parseMeasures(html: string): MeasureMap`
  - `healthEnvUrlFor(semsSiteId: string): string`

**This is the highest-risk file in the codebase.** Two verified hazards:

1. The table's third column is an explanatory legend that repeats the strings `Human Exposure Under Control`, `Under Control`, `Insufficient data`, and `No` in prose. **Any text-level regex over the flattened page produces false matches.** The parser must find the table, split it into rows, and read only cell index 1 of each row.
2. Some sites have no Performance Measures table at all (1 of 21 sampled — a Proposed site). All four fields must come back `null`, with no throw.

- [ ] **Step 1: Capture the two fixtures**

```bash
mkdir -p src/lib/server/ingest/fixtures
curl -sL -A 'exposure-tracking-map/1.0 (research)' \
  'https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm?fuseaction=second.Healthenv&id=0100041' \
  -o src/lib/server/ingest/fixtures/measures-linemaster.html
curl -sL -A 'exposure-tracking-map/1.0 (research)' \
  'https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm?fuseaction=second.Healthenv&id=0100460' \
  -o src/lib/server/ingest/fixtures/measures-none.html
```

Verify the captures are what you expect before continuing:

```bash
grep -c 'Human Exposure Under Control' src/lib/server/ingest/fixtures/measures-linemaster.html  # >= 1
grep -c 'Performance' src/lib/server/ingest/fixtures/measures-none.html                          # expect 0
```

If `measures-none.html` unexpectedly contains a measures table, EPA has since populated that site. Find another Proposed-status site with no table and use it instead, or hand-write a minimal fixture containing the page shell without a measures table.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/server/ingest/parseMeasures.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { healthEnvUrlFor, parseMeasures } from './parseMeasures';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('healthEnvUrlFor', () => {
  it('targets the Healthenv fuseaction, not the cleanup page', () => {
    const url = healthEnvUrlFor('0100041');
    expect(url).toContain('fuseaction=second.Healthenv');
    expect(url).toContain('id=0100041');
  });
});

describe('parseMeasures', () => {
  it('reads all four measures from a real page', () => {
    expect(parseMeasures(fixture('measures-linemaster.html'))).toEqual({
      humanExposureStatus: 'Yes',
      groundwaterMigrationStatus: 'Yes',
      constructionComplete: 'Yes',
      sitewideReadyForUse: 'No'
    });
  });

  it('returns all nulls for a page with no measures table', () => {
    expect(parseMeasures(fixture('measures-none.html'))).toEqual({
      humanExposureStatus: null,
      groundwaterMigrationStatus: null,
      constructionComplete: null,
      sitewideReadyForUse: null
    });
  });

  it('ignores the legend column, which repeats the measure phrases', () => {
    // The real page's third cell contains "Insufficient data means that..."
    // and a bare "No means...". A text-level parser would return one of those.
    const result = parseMeasures(fixture('measures-linemaster.html'));
    expect(result.humanExposureStatus).toBe('Yes');
    expect(result.humanExposureStatus).not.toContain('means');
  });

  it('handles the groundwater-specific value', () => {
    const html = `
      <table><thead><tr><th>Performance<br/>Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
      <tbody>
        <tr><td>Human Exposure Under Control</td><td> No </td><td><strong>Yes</strong> means blah</td></tr>
        <tr><td>Groundwater Migration Under Control</td><td>Not a Groundwater Site</td><td>legend</td></tr>
      </tbody></table>`;
    const r = parseMeasures(html);
    expect(r.humanExposureStatus).toBe('No');
    expect(r.groundwaterMigrationStatus).toBe('Not a Groundwater Site');
  });

  it('handles Insufficient Data and Status Unavailable', () => {
    const html = `
      <table><thead><tr><th>Performance Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
      <tbody>
        <tr><td>Human Exposure Under Control</td><td>Insufficient Data</td><td>legend</td></tr>
        <tr><td>Groundwater Migration Under Control</td><td>Status Unavailable</td><td>legend</td></tr>
      </tbody></table>`;
    const r = parseMeasures(html);
    expect(r.humanExposureStatus).toBe('Insufficient Data');
    expect(r.groundwaterMigrationStatus).toBe('Status Unavailable');
  });

  it('strips nested markup and collapses whitespace in a status cell', () => {
    const html = `
      <table><thead><tr><th>Performance Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
      <tbody><tr><td>Construction Complete</td><td>\n  <strong>Yes</strong>\n </td><td>legend</td></tr></tbody></table>`;
    expect(parseMeasures(html).constructionComplete).toBe('Yes');
  });

  it('decodes HTML entities', () => {
    const html = `
      <table><thead><tr><th>Performance Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
      <tbody><tr><td>Human&nbsp;Exposure Under Control</td><td>Yes</td><td>legend</td></tr></tbody></table>`;
    expect(parseMeasures(html).humanExposureStatus).toBe('Yes');
  });

  it('returns nulls rather than throwing on empty or garbage input', () => {
    for (const input of ['', '<html></html>', 'not html at all']) {
      expect(parseMeasures(input).humanExposureStatus).toBeNull();
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test src/lib/server/ingest/parseMeasures.test.ts`
Expected: FAIL — cannot resolve `./parseMeasures`.

- [ ] **Step 4: Implement the parser**

```ts
// src/lib/server/ingest/parseMeasures.ts

export type MeasureMap = {
  humanExposureStatus: string | null;
  groundwaterMigrationStatus: string | null;
  constructionComplete: string | null;
  sitewideReadyForUse: string | null;
};

const HEALTHENV_BASE =
  'https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm?fuseaction=second.Healthenv&id=';

export function healthEnvUrlFor(semsSiteId: string): string {
  return `${HEALTHENV_BASE}${semsSiteId}`;
}

/** Measure label on the page -> field name in our schema. */
const LABEL_TO_FIELD: Record<string, keyof MeasureMap> = {
  'human exposure under control': 'humanExposureStatus',
  'groundwater migration under control': 'groundwaterMigrationStatus',
  'construction complete': 'constructionComplete',
  'sitewide ready for anticipated use': 'sitewideReadyForUse'
};

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&rsquo;': '’'
};

/** Strip tags, decode the entities EPA actually emits, collapse whitespace. */
function cellText(html: string): string {
  let s = html.replace(/<[^>]*>/g, ' ');
  for (const [entity, char] of Object.entries(ENTITIES)) {
    s = s.split(entity).join(char);
  }
  s = s.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  return s.replace(/\s+/g, ' ').trim();
}

const EMPTY: MeasureMap = {
  humanExposureStatus: null,
  groundwaterMigrationStatus: null,
  constructionComplete: null,
  sitewideReadyForUse: null
};

/**
 * Extract the four performance measures from an EPA site-profile Healthenv page.
 *
 * Structural, not textual, by necessity: the table's third column is a legend
 * that repeats every measure label and every possible status value in prose.
 * We locate the table by its header, then read cell index 1 of each row and
 * discard the rest. Never throws — a page without the table yields all nulls.
 */
export function parseMeasures(html: string): MeasureMap {
  const result: MeasureMap = { ...EMPTY };

  for (const tableMatch of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const table = tableMatch[1];
    // The header spans a <br/>, so match on the words rather than the phrase.
    if (!/Performance[\s\S]{0,40}Measure/i.test(table)) continue;

    for (const rowMatch of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
        cellText(m[1])
      );
      if (cells.length < 2) continue; // header row, or a malformed row

      const field = LABEL_TO_FIELD[cells[0].toLowerCase()];
      if (!field) continue;

      const status = cells[1];
      result[field] = status === '' ? null : status;
    }

    // Found and consumed the measures table; no need to scan further tables.
    if (Object.values(result).some((v) => v !== null)) return result;
  }

  return result;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/lib/server/ingest/parseMeasures.test.ts`
Expected: 9 tests PASS.

If the real-page test fails on `sitewideReadyForUse`, print the parsed object and compare against the live page — EPA may have updated that site's status since the fixture was captured. Update the expectation to match the fixture, not the other way around.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/ingest/parseMeasures.ts src/lib/server/ingest/parseMeasures.test.ts src/lib/server/ingest/fixtures/
git commit -m "feat: add structural parser for EPA performance measures"
```

---

## Task 9: Measures scraper

**Files:**
- Create: `src/lib/server/ingest/sources/measures.ts`
- Modify: `src/lib/server/ingest/upsert.ts` (append), `scripts/download.ts`
- Test: `src/lib/server/ingest/sources/measures.test.ts`

**Interfaces:**
- Consumes: `parseMeasures`/`healthEnvUrlFor`/`MeasureMap` from `../parseMeasures`, `readCache`/`writeCache`, `USER_AGENT`.
- Produces:
  - `fetchMeasures(semsSiteId, opts?): Promise<MeasureMap | null>` — `null` only when every attempt failed
  - `upsertMeasures(prisma, semsSiteId, measures): Promise<void>`

**Politeness is a hard requirement,** not a nicety: 1,840 sequential requests against a government server. 400 ms delay, descriptive `User-Agent`, at most 2 retries. Per-site caching means an interrupted run resumes instead of restarting.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/ingest/sources/measures.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMeasures } from './measures';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'etm-meas-'));
  process.env.ETM_CACHE_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.ETM_CACHE_DIR;
});

const PAGE = `
  <table><thead><tr><th>Performance<br/>Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
  <tbody>
    <tr><td>Human Exposure Under Control</td><td>Yes</td><td>legend</td></tr>
    <tr><td>Groundwater Migration Under Control</td><td>No</td><td>legend</td></tr>
    <tr><td>Construction Complete</td><td>Yes</td><td>legend</td></tr>
    <tr><td>Sitewide Ready for Anticipated Use</td><td>No</td><td>legend</td></tr>
  </tbody></table>`;

const ok = () => new Response(PAGE, { status: 200 });

describe('fetchMeasures', () => {
  it('parses a fetched page', async () => {
    const fetchImpl = vi.fn(async () => ok()) as unknown as typeof fetch;
    const m = await fetchMeasures('0100041', { fetchImpl, delayMs: 0 });
    expect(m).toEqual({
      humanExposureStatus: 'Yes',
      groundwaterMigrationStatus: 'No',
      constructionComplete: 'Yes',
      sitewideReadyForUse: 'No'
    });
  });

  it('requests the Healthenv page for the given site id', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (u: string | URL) => {
      urls.push(String(u));
      return ok();
    }) as unknown as typeof fetch;
    await fetchMeasures('0100041', { fetchImpl, delayMs: 0 });
    expect(urls[0]).toContain('fuseaction=second.Healthenv');
    expect(urls[0]).toContain('id=0100041');
  });

  it('sends a descriptive User-Agent', async () => {
    let headers: HeadersInit | undefined;
    const fetchImpl = vi.fn(async (_u: string | URL, init?: RequestInit) => {
      headers = init?.headers;
      return ok();
    }) as unknown as typeof fetch;
    await fetchMeasures('0100041', { fetchImpl, delayMs: 0 });
    expect(String((headers as Record<string, string>)['User-Agent'])).toContain(
      'exposure-tracking-map'
    );
  });

  it('caches per site so a second call does not refetch', async () => {
    const fetchImpl = vi.fn(async () => ok()) as unknown as typeof fetch;
    await fetchMeasures('0100041', { fetchImpl, delayMs: 0 });
    await fetchMeasures('0100041', { fetchImpl, delayMs: 0 });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('retries at most twice, then returns null', async () => {
    const fetchImpl = vi.fn(async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    expect(await fetchMeasures('0100041', { fetchImpl, delayMs: 0 })).toBeNull();
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it('recovers when a retry succeeds', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      return n === 1 ? new Response('x', { status: 503 }) : ok();
    }) as unknown as typeof fetch;
    const m = await fetchMeasures('0100041', { fetchImpl, delayMs: 0 });
    expect(m?.humanExposureStatus).toBe('Yes');
  });

  it('returns an all-null map, and caches it, for a page with no table', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('<html><body>no measures here</body></html>', { status: 200 })
    ) as unknown as typeof fetch;
    const m = await fetchMeasures('0100460', { fetchImpl, delayMs: 0 });
    expect(m).toEqual({
      humanExposureStatus: null,
      groundwaterMigrationStatus: null,
      constructionComplete: null,
      sitewideReadyForUse: null
    });
    await fetchMeasures('0100460', { fetchImpl, delayMs: 0 });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('survives a thrown network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    expect(await fetchMeasures('0100041', { fetchImpl, delayMs: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/lib/server/ingest/sources/measures.test.ts`
Expected: FAIL — cannot resolve `./measures`.

- [ ] **Step 3: Implement the scraper**

```ts
// src/lib/server/ingest/sources/measures.ts
import { readCache, writeCache } from '../cache';
import { healthEnvUrlFor, parseMeasures, type MeasureMap } from '../parseMeasures';
import { USER_AGENT } from './sites';

export const SCRAPE_DELAY_MS = 400;
export const MAX_RETRIES = 2;

export type MeasureFetchOptions = {
  refresh?: boolean;
  fetchImpl?: typeof fetch;
  /** Overridable so tests do not actually wait. */
  delayMs?: number;
};

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

/**
 * Fetch and parse one site's performance measures.
 *
 * Returns an all-null MeasureMap when the page has no measures table — that is
 * a valid outcome, cached like any other. Returns null only when every attempt
 * failed, so the caller can count it as an error without aborting the pass.
 */
export async function fetchMeasures(
  semsSiteId: string,
  opts: MeasureFetchOptions = {}
): Promise<MeasureMap | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const delayMs = opts.delayMs ?? SCRAPE_DELAY_MS;
  const key = `measures-${semsSiteId}`;

  if (!opts.refresh) {
    // Measures change slowly; keep them for a week.
    const cached = readCache<MeasureMap>(key, 7 * 24 * 60 * 60 * 1000);
    if (cached) return cached;
  }

  const url = healthEnvUrlFor(semsSiteId);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) await sleep(delayMs * (attempt + 1));
    try {
      const res = await doFetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) {
        console.warn(`[measures] ${semsSiteId} attempt ${attempt + 1}: HTTP ${res.status}`);
        continue;
      }
      const measures = parseMeasures(await res.text());
      writeCache(key, measures);
      return measures;
    } catch (err) {
      console.warn(
        `[measures] ${semsSiteId} attempt ${attempt + 1}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  console.warn(`[measures] ${semsSiteId}: giving up after ${MAX_RETRIES + 1} attempts`);
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/server/ingest/sources/measures.test.ts`
Expected: 8 tests PASS.

- [ ] **Step 5: Append the measures upsert**

In `upsert.ts`, add the import and the function:

```ts
import type { MeasureMap } from './parseMeasures';
```

```ts
/** Write one site's performance measures, stamping when they were fetched. */
export async function upsertMeasures(
  prisma: PrismaClient,
  semsSiteId: string,
  measures: MeasureMap
): Promise<void> {
  await prisma.site.update({
    where: { semsSiteId },
    data: { ...measures, measuresFetchedAt: new Date() }
  });
}
```

- [ ] **Step 6: Wire measures into the CLI**

New imports in `scripts/download.ts`:

```ts
import { fetchMeasures, SCRAPE_DELAY_MS } from '../src/lib/server/ingest/sources/measures';
import { upsertContaminants, upsertMeasures, upsertSites, withIngestRun } from '../src/lib/server/ingest/upsert';
```

New function:

```ts
async function ingestMeasures(prisma: PrismaClient, args: Args): Promise<void> {
  const all = await prisma.site.findMany({
    select: { semsSiteId: true },
    orderBy: { semsSiteId: 'asc' }
  });
  if (all.length === 0) {
    throw new Error('No sites in the database — run `pnpm download --source=sites` first');
  }

  const sites = args.limit ? all.slice(0, args.limit) : all;
  const estimateMinutes = Math.ceil((sites.length * SCRAPE_DELAY_MS) / 60000);
  console.log(
    `[measures] scraping ${sites.length} of ${all.length} sites (~${estimateMinutes} min)` +
      (args.limit ? ` — limited by --limit=${args.limit}` : '')
  );

  if (args.dryRun) {
    console.log('[measures] dry run — nothing fetched or written');
    return;
  }

  await withIngestRun(prisma, 'measures', async () => {
    let upserted = 0;
    let failed = 0;

    for (const [index, { semsSiteId }] of sites.entries()) {
      const measures = await fetchMeasures(semsSiteId, { refresh: args.refresh });
      if (measures === null) {
        failed += 1;
      } else {
        await upsertMeasures(prisma, semsSiteId, measures);
        upserted += 1;
      }
      if ((index + 1) % 100 === 0) {
        console.log(`[measures] ${index + 1}/${sites.length} (${failed} failed)`);
      }
    }

    console.log(`[measures] upserted ${upserted}, failed ${failed}`);
    return { upserted, rejected: failed, value: undefined };
  });
}
```

Call it last in `main`:

```ts
    if (args.sources.includes('measures')) await ingestMeasures(prisma, args);
```

Note the source order in `ALL_SOURCES` already puts measures last, so a bare `pnpm download` runs sites → contaminants → measures.

- [ ] **Step 7: Verify with a small live run**

Run: `pnpm download --source=measures --limit=25`
Expected: 25 sites scraped in roughly 10–20 seconds, `upserted 25, failed 0`.

Confirm the distribution looks plausible:

```bash
pnpm exec prisma db execute --stdin <<'SQL'
SELECT humanExposureStatus, COUNT(*) FROM Site GROUP BY humanExposureStatus;
SQL
```

Expected: mostly `Yes`, some `NULL` for sites not yet scraped.

- [ ] **Step 8: Run the full pass**

Run: `pnpm download --source=measures`
Expected: ~15–25 minutes, progress every 100 sites. The 25 already-cached sites are served from `.cache/` instantly. A handful of failures is acceptable; hundreds means something changed upstream — stop and investigate.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scrape per-site performance measures with caching and retries"
```

---

## Task 10: Proximity ranking

**Files:**
- Create: `src/lib/server/proximity.ts`
- Test: `src/lib/server/proximity.test.ts`

**Interfaces:**
- Consumes: `haversineMiles` from `$lib/geo/haversine`, `LatLng` from `$lib/geo/types`.
- Produces:
  - `RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const`
  - `DEFAULT_RADIUS_MILES = 25`
  - `type Candidate = LatLng & { [k: string]: unknown }`
  - `rankByDistance<T extends LatLng>(center, candidates): Array<T & { distanceMiles: number }>`
  - `withinRadius<T extends LatLng>(center, candidates, miles): Array<T & { distanceMiles: number }>`
  - `nearest<T extends LatLng>(center, candidates, count): Array<T & { distanceMiles: number }>`
  - `isValidRadius(value: unknown): value is number`

Pure module — no Prisma import, so it is trivially testable and reusable.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/proximity.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RADIUS_MILES,
  isValidRadius,
  nearest,
  RADIUS_OPTIONS,
  rankByDistance,
  withinRadius
} from './proximity';

const CENTER = { latitude: 38.898699, longitude: -77.035188 }; // White House

const site = (name: string, latitude: number, longitude: number) => ({
  name,
  latitude,
  longitude
});

// Roughly 1, 7, and 70 miles out, due north.
const CLOSE = site('close', 38.9131, -77.035188);
const MID = site('mid', 39.0, -77.035188);
const FAR = site('far', 39.9, -77.035188);

describe('radius options', () => {
  it('matches the spec exactly', () => {
    expect(RADIUS_OPTIONS).toEqual([5, 10, 25, 50, 100]);
    expect(DEFAULT_RADIUS_MILES).toBe(25);
  });

  it('validates radius input', () => {
    expect(isValidRadius(25)).toBe(true);
    expect(isValidRadius(30)).toBe(false);
    expect(isValidRadius('25')).toBe(false);
    expect(isValidRadius(null)).toBe(false);
  });
});

describe('rankByDistance', () => {
  it('sorts nearest first and attaches distances', () => {
    const ranked = rankByDistance(CENTER, [FAR, CLOSE, MID]);
    expect(ranked.map((r) => r.name)).toEqual(['close', 'mid', 'far']);
    expect(ranked[0].distanceMiles).toBeLessThan(ranked[1].distanceMiles);
  });

  it('rounds distance to one decimal place', () => {
    const [first] = rankByDistance(CENTER, [CLOSE]);
    expect(first.distanceMiles).toBe(Math.round(first.distanceMiles * 10) / 10);
  });

  it('preserves the candidate fields', () => {
    const [first] = rankByDistance(CENTER, [{ ...CLOSE, epaId: 'X1' }]);
    expect(first.epaId).toBe('X1');
  });

  it('returns an empty array for no candidates', () => {
    expect(rankByDistance(CENTER, [])).toEqual([]);
  });
});

describe('withinRadius', () => {
  it('includes only candidates inside the radius', () => {
    const r = withinRadius(CENTER, [CLOSE, MID, FAR], 25);
    expect(r.map((x) => x.name)).toEqual(['close', 'mid']);
  });

  it('returns empty when nothing is in range', () => {
    expect(withinRadius(CENTER, [FAR], 5)).toEqual([]);
  });

  it('includes a candidate exactly at the boundary', () => {
    const boundary = site('boundary', CENTER.latitude + 25 / MILES_PER_DEGREE_LAT, CENTER.longitude);
    // Confirm the fixture really is at the radius before relying on it.
    expect(haversineMiles(CENTER, boundary)).toBeCloseTo(25, 3);
    expect(withinRadius(CENTER, [boundary], 25)).toHaveLength(1);
  });

  it('excludes a candidate just past the boundary', () => {
    // Far enough out that rounding to one decimal cannot pull it back to 25.0.
    const justOutside = site('just-outside', CENTER.latitude + 25.1 / MILES_PER_DEGREE_LAT, CENTER.longitude);
    expect(haversineMiles(CENTER, justOutside)).toBeGreaterThan(25);
    expect(withinRadius(CENTER, [justOutside], 25)).toHaveLength(0);
  });
});

describe('nearest', () => {
  it('returns the n closest regardless of distance', () => {
    const r = nearest(CENTER, [FAR, CLOSE, MID], 2);
    expect(r.map((x) => x.name)).toEqual(['close', 'mid']);
  });

  it('returns everything when asked for more than exists', () => {
    expect(nearest(CENTER, [CLOSE], 3)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/lib/server/proximity.test.ts`
Expected: FAIL — cannot resolve `./proximity`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/proximity.ts
import { haversineMiles } from '$lib/geo/haversine';
import type { LatLng } from '$lib/geo/types';

export const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
export const DEFAULT_RADIUS_MILES = 25;

export type Ranked<T> = T & { distanceMiles: number };

export function isValidRadius(value: unknown): value is number {
  return typeof value === 'number' && (RADIUS_OPTIONS as readonly number[]).includes(value);
}

/** Attach a straight-line distance to every candidate and sort nearest first. */
export function rankByDistance<T extends LatLng>(center: LatLng, candidates: T[]): Ranked<T>[] {
  return candidates
    .map((c) => ({
      ...c,
      distanceMiles: Math.round(haversineMiles(center, c) * 10) / 10
    }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

/**
 * Exact radius filter. Applied after the bounding-box prefilter, which
 * over-selects by design.
 */
export function withinRadius<T extends LatLng>(
  center: LatLng,
  candidates: T[],
  miles: number
): Ranked<T>[] {
  return rankByDistance(center, candidates).filter((c) => c.distanceMiles <= miles);
}

/** The `count` closest candidates, ignoring any radius. */
export function nearest<T extends LatLng>(
  center: LatLng,
  candidates: T[],
  count: number
): Ranked<T>[] {
  return rankByDistance(center, candidates).slice(0, count);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/server/proximity.test.ts`
Expected: 11 tests PASS.

Derive `MILES_PER_DEGREE_LAT` in the test from the shared `EARTH_RADIUS_MILES` export -- `(Math.PI * EARTH_RADIUS_MILES) / 180` -- rather than hardcoding an approximation. A hardcoded 69.055 puts the "boundary" fixture at 25.014 mi, so the test passes only because of the one-decimal rounding and never exercises the true geometric edge. Keep the rounding itself: the API contract returns one decimal place.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/proximity.ts src/lib/server/proximity.test.ts
git commit -m "feat: add distance ranking with radius filter and nearest-n fallback"
```

---

## Task 11: Census geocoder with database cache

**Files:**
- Create: `src/lib/server/geocode/census.ts`, `src/lib/server/geocode/index.ts`
- Test: `src/lib/server/geocode/census.test.ts`, `src/lib/server/geocode/cache.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except the `GeocodeCache` model.
- Produces:
  - `type GeocodeResult = { latitude: number; longitude: number; matchedAddress: string; provider: string }`
  - `class GeocodeNotFoundError extends Error`
  - `class GeocoderUnavailableError extends Error`
  - `normalizeQuery(address: string): string`
  - `geocodeWithCensus(address, opts?): Promise<GeocodeResult>`
  - `geocode(prisma, address, opts?): Promise<GeocodeResult>` — cache-wrapped

**The one thing to get right:** Census returns `coordinates.x` as **longitude** and `coordinates.y` as **latitude**. The test asserts this explicitly with values where swapping them would be obvious.

Two error classes exist because Task 12 maps them to different HTTP statuses: not-found is `422` and permanent; unavailable is `503` and retryable, and must not poison the cache.

- [ ] **Step 1: Write the failing census test**

```ts
// src/lib/server/geocode/census.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  GeocodeNotFoundError,
  GeocoderUnavailableError,
  geocodeWithCensus,
  normalizeQuery
} from './census';

// Trimmed from a real response for 1600 Pennsylvania Avenue NW.
const MATCH_BODY = {
  result: {
    addressMatches: [
      {
        matchedAddress: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500',
        coordinates: { x: -77.03518753691, y: 38.89869893252 }
      }
    ]
  }
};

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('normalizeQuery', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeQuery('  1600  Pennsylvania   Ave NW ')).toBe('1600 pennsylvania ave nw');
  });

  it('is stable across casing and spacing variants', () => {
    expect(normalizeQuery('123 Main St')).toBe(normalizeQuery('123   MAIN st'));
  });
});

describe('geocodeWithCensus', () => {
  it('maps x to longitude and y to latitude, not the reverse', async () => {
    const fetchImpl = vi.fn(async () => respond(MATCH_BODY)) as unknown as typeof fetch;
    const r = await geocodeWithCensus('1600 Pennsylvania Ave NW', { fetchImpl });

    expect(r.latitude).toBeCloseTo(38.8987, 3);
    expect(r.longitude).toBeCloseTo(-77.0352, 3);
    // Latitude can never exceed 90 — a swap would put -77 in latitude.
    expect(Math.abs(r.latitude)).toBeLessThanOrEqual(90);
    expect(r.provider).toBe('census');
    expect(r.matchedAddress).toContain('PENNSYLVANIA');
  });

  it('sends the current public benchmark and requests JSON', async () => {
    let url = '';
    const fetchImpl = vi.fn(async (u: string | URL) => {
      url = String(u);
      return respond(MATCH_BODY);
    }) as unknown as typeof fetch;
    await geocodeWithCensus('anywhere', { fetchImpl });
    expect(url).toContain('onelineaddress');
    expect(url).toContain('benchmark=Public_AR_Current');
    expect(url).toContain('format=json');
    expect(url).toContain('address=anywhere');
  });

  it('throws GeocodeNotFoundError on zero matches', async () => {
    const fetchImpl = vi.fn(async () =>
      respond({ result: { addressMatches: [] } })
    ) as unknown as typeof fetch;
    await expect(geocodeWithCensus('nowhere at all', { fetchImpl })).rejects.toThrow(
      GeocodeNotFoundError
    );
  });

  it('throws GeocoderUnavailableError on a server error', async () => {
    const fetchImpl = vi.fn(async () => respond({}, 503)) as unknown as typeof fetch;
    await expect(geocodeWithCensus('x', { fetchImpl })).rejects.toThrow(GeocoderUnavailableError);
  });

  it('throws GeocoderUnavailableError on a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    }) as unknown as typeof fetch;
    await expect(geocodeWithCensus('x', { fetchImpl })).rejects.toThrow(GeocoderUnavailableError);
  });

  it('throws GeocoderUnavailableError on malformed JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    await expect(geocodeWithCensus('x', { fetchImpl })).rejects.toThrow(GeocoderUnavailableError);
  });

  it('rejects a blank address without calling the network', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(geocodeWithCensus('   ', { fetchImpl })).rejects.toThrow(GeocodeNotFoundError);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/lib/server/geocode/census.test.ts`
Expected: FAIL — cannot resolve `./census`.

- [ ] **Step 3: Implement the Census geocoder**

```ts
// src/lib/server/geocode/census.ts

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  matchedAddress: string;
  provider: string;
};

/** The address could not be matched. Permanent for this input; do not retry. */
export class GeocodeNotFoundError extends Error {
  constructor(address: string) {
    super(`No match for address: ${address}`);
    this.name = 'GeocodeNotFoundError';
  }
}

/** The geocoder itself failed. Transient; safe to retry, must not be cached. */
export class GeocoderUnavailableError extends Error {
  constructor(cause: string) {
    super(`Geocoder unavailable: ${cause}`);
    this.name = 'GeocoderUnavailableError';
  }
}

const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

/** Cache key: case- and whitespace-insensitive. */
export function normalizeQuery(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ');
}

type CensusResponse = {
  result?: {
    addressMatches?: Array<{
      matchedAddress?: string;
      coordinates?: { x?: number; y?: number };
    }>;
  };
};

export async function geocodeWithCensus(
  address: string,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<GeocodeResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  if (normalizeQuery(address) === '') throw new GeocodeNotFoundError(address);

  const url = `${ENDPOINT}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;

  let body: CensusResponse;
  try {
    const res = await doFetch(url);
    if (!res.ok) throw new GeocoderUnavailableError(`HTTP ${res.status}`);
    body = (await res.json()) as CensusResponse;
  } catch (err) {
    if (err instanceof GeocoderUnavailableError) throw err;
    throw new GeocoderUnavailableError(err instanceof Error ? err.message : String(err));
  }

  const match = body.result?.addressMatches?.[0];
  // Census's x is LONGITUDE and y is LATITUDE. Do not swap these.
  const longitude = match?.coordinates?.x;
  const latitude = match?.coordinates?.y;

  if (!match || typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new GeocodeNotFoundError(address);
  }

  return {
    latitude,
    longitude,
    matchedAddress: match.matchedAddress ?? address,
    provider: 'census'
  };
}
```

- [ ] **Step 4: Run the census test to verify it passes**

Run: `pnpm test src/lib/server/geocode/census.test.ts`
Expected: 9 tests PASS.

- [ ] **Step 5: Write the failing cache-wrapper test**

```ts
// src/lib/server/geocode/cache.test.ts
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeocodeNotFoundError, GeocoderUnavailableError } from './census';
import { geocode } from './index';

let prisma: PrismaClient;
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'etm-geo-'));
  const url = `file:${join(dir, 'test.db')}`;
  execSync('pnpm exec prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url } });
  prisma = new PrismaClient({ datasources: { db: { url } } });
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await prisma.geocodeCache.deleteMany();
});

const result = {
  latitude: 38.898699,
  longitude: -77.035188,
  matchedAddress: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500',
  provider: 'census'
};

describe('geocode', () => {
  it('calls the geocoder on a cache miss and stores the result', async () => {
    const impl = vi.fn(async () => result);
    const r = await geocode(prisma, '1600 Pennsylvania Ave NW', { geocoderImpl: impl });
    expect(r).toMatchObject(result);
    expect(await prisma.geocodeCache.count()).toBe(1);
  });

  it('serves a second identical call from cache', async () => {
    const impl = vi.fn(async () => result);
    await geocode(prisma, '1600 Pennsylvania Ave NW', { geocoderImpl: impl });
    await geocode(prisma, '1600 Pennsylvania Ave NW', { geocoderImpl: impl });
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('treats casing and spacing variants as the same cache entry', async () => {
    const impl = vi.fn(async () => result);
    await geocode(prisma, '1600 Pennsylvania Ave NW', { geocoderImpl: impl });
    await geocode(prisma, '  1600   PENNSYLVANIA ave nw ', { geocoderImpl: impl });
    expect(impl).toHaveBeenCalledTimes(1);
    expect(await prisma.geocodeCache.count()).toBe(1);
  });

  it('does not cache a not-found result', async () => {
    const impl = vi.fn(async () => {
      throw new GeocodeNotFoundError('nowhere');
    });
    await expect(geocode(prisma, 'nowhere', { geocoderImpl: impl })).rejects.toThrow(
      GeocodeNotFoundError
    );
    expect(await prisma.geocodeCache.count()).toBe(0);
  });

  it('does not cache an unavailable result, so a retry can succeed', async () => {
    let n = 0;
    const impl = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new GeocoderUnavailableError('HTTP 503');
      return result;
    });
    await expect(geocode(prisma, 'x', { geocoderImpl: impl })).rejects.toThrow(
      GeocoderUnavailableError
    );
    expect(await prisma.geocodeCache.count()).toBe(0);

    const r = await geocode(prisma, 'x', { geocoderImpl: impl });
    expect(r.latitude).toBeCloseTo(38.898699, 5);
    expect(await prisma.geocodeCache.count()).toBe(1);
  });

  it('round-trips coordinates through the cache without swapping them', async () => {
    const impl = vi.fn(async () => result);
    await geocode(prisma, 'x', { geocoderImpl: impl });
    const cached = await geocode(prisma, 'x', { geocoderImpl: impl });
    expect(cached.latitude).toBeCloseTo(38.898699, 5);
    expect(cached.longitude).toBeCloseTo(-77.035188, 5);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm test src/lib/server/geocode/cache.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 7: Implement the cache wrapper**

```ts
// src/lib/server/geocode/index.ts
import type { PrismaClient } from '@prisma/client';
import { geocodeWithCensus, normalizeQuery, type GeocodeResult } from './census';

export { GeocodeNotFoundError, GeocoderUnavailableError, normalizeQuery } from './census';
export type { GeocodeResult } from './census';

/** Any address-to-coordinates implementation. Swap providers here. */
export type Geocoder = (address: string) => Promise<GeocodeResult>;

export type GeocodeOptions = { geocoderImpl?: Geocoder };

/**
 * Geocode an address, reading through a database-backed cache.
 *
 * Only successes are cached. A not-found is not cached because EPA's data and
 * Census's address ranges both change; an unavailable is not cached because it
 * says nothing about the address.
 */
export async function geocode(
  prisma: PrismaClient,
  address: string,
  opts: GeocodeOptions = {}
): Promise<GeocodeResult> {
  const impl = opts.geocoderImpl ?? ((a: string) => geocodeWithCensus(a));
  const normalizedQuery = normalizeQuery(address);

  const cached = await prisma.geocodeCache.findUnique({ where: { normalizedQuery } });
  if (cached) {
    return {
      latitude: cached.latitude,
      longitude: cached.longitude,
      matchedAddress: cached.matchedAddress,
      provider: cached.provider
    };
  }

  const result = await impl(address);

  await prisma.geocodeCache.upsert({
    where: { normalizedQuery },
    create: { normalizedQuery, ...result },
    update: { ...result }
  });

  return result;
}
```

- [ ] **Step 8: Run both geocode tests to verify they pass**

Run: `pnpm test src/lib/server/geocode/`
Expected: 15 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/server/geocode/
git commit -m "feat: add keyless Census geocoder with database-backed cache"
```

---

## Task 12: Query layer and API routes

**Files:**
- Create: `src/lib/server/queries.ts`, `src/lib/server/search.ts`, `src/routes/api/sites/+server.ts`, `src/routes/api/sites/[epaId]/+server.ts`, `src/routes/api/search/+server.ts`
- Test: `src/lib/server/queries.test.ts`, `src/lib/server/search.test.ts`

**Interfaces:**
- Consumes: `boundingBox` from `$lib/geo/bbox`, `withinRadius`/`nearest`/`isValidRadius`/`DEFAULT_RADIUS_MILES` from `./proximity`, `geocode` + error classes from `./geocode`.
- Produces:
  - `sitesGeoJson(prisma): Promise<FeatureCollection>`
  - `siteDetail(prisma, epaId): Promise<SiteDetail | null>`
  - `type SiteDetail` — includes `contaminantsByMedium: Array<{ medium: string; contaminants: string[] }>`
  - `searchSites(prisma, { address, radiusMiles }, opts?): Promise<SearchResponse>`
  - `type SearchResponse` — the exact shape Task 14's page consumes

**Design note:** all logic lives in plain functions that take a `PrismaClient` argument. The route files are thin wrappers that supply the singleton. This keeps everything testable without a SvelteKit runtime, because importing `$env/dynamic/private` outside one throws.

- [ ] **Step 1: Write the failing queries test**

```ts
// src/lib/server/queries.test.ts
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { siteDetail, sitesGeoJson } from './queries';

let prisma: PrismaClient;
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'etm-q-'));
  const url = `file:${join(dir, 'test.db')}`;
  execSync('pnpm exec prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url } });
  prisma = new PrismaClient({ datasources: { db: { url } } });
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await prisma.siteContaminant.deleteMany();
  await prisma.contaminant.deleteMany();
  await prisma.site.deleteMany();
});

async function seed() {
  const site = await prisma.site.create({
    data: {
      semsSiteId: '0100041',
      epaId: 'CTD001153923',
      name: 'LINEMASTER SWITCH CORP.',
      streetAddress: '29 PLAINE HILL ROAD',
      city: 'WOODSTOCK',
      county: 'WINDHAM',
      state: 'CT',
      latitude: 41.940561,
      longitude: -71.966939,
      nplStatusCode: 'F',
      nplStatusName: 'Currently on the Final NPL',
      humanExposureStatus: 'Yes',
      groundwaterMigrationStatus: 'Yes',
      constructionComplete: 'Yes',
      sitewideReadyForUse: 'No',
      epaRegion: '01',
      profileUrl: 'https://example.invalid/p'
    }
  });
  const tce = await prisma.contaminant.create({ data: { name: 'TRICHLOROETHENE' } });
  const pb = await prisma.contaminant.create({ data: { name: 'LEAD' } });
  await prisma.siteContaminant.createMany({
    data: [
      { siteId: site.id, contaminantId: tce.id, media: 'Groundwater' },
      { siteId: site.id, contaminantId: pb.id, media: 'Groundwater' },
      { siteId: site.id, contaminantId: pb.id, media: 'Soil' }
    ]
  });
  return site;
}

describe('sitesGeoJson', () => {
  it('returns an empty FeatureCollection when there are no sites', async () => {
    const fc = await sitesGeoJson(prisma);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toEqual([]);
  });

  it('emits GeoJSON coordinates as [longitude, latitude]', async () => {
    await seed();
    const fc = await sitesGeoJson(prisma);
    expect(fc.features).toHaveLength(1);
    const [lon, lat] = fc.features[0].geometry.coordinates;
    expect(lon).toBeCloseTo(-71.966939, 6);
    expect(lat).toBeCloseTo(41.940561, 6);
  });

  it('carries the properties the map needs for styling', async () => {
    await seed();
    const [feature] = (await sitesGeoJson(prisma)).features;
    expect(feature.properties).toMatchObject({
      epaId: 'CTD001153923',
      name: 'LINEMASTER SWITCH CORP.',
      state: 'CT',
      nplStatusCode: 'F',
      humanExposureStatus: 'Yes'
    });
  });
});

describe('siteDetail', () => {
  it('returns null for an unknown epaId', async () => {
    expect(await siteDetail(prisma, 'NOPE')).toBeNull();
  });

  it('groups contaminants by medium, sorted and deduplicated', async () => {
    await seed();
    const detail = await siteDetail(prisma, 'CTD001153923');
    expect(detail?.contaminantsByMedium).toEqual([
      { medium: 'Groundwater', contaminants: ['LEAD', 'TRICHLOROETHENE'] },
      { medium: 'Soil', contaminants: ['LEAD'] }
    ]);
  });

  it('includes all four performance measures', async () => {
    await seed();
    const detail = await siteDetail(prisma, 'CTD001153923');
    expect(detail).toMatchObject({
      humanExposureStatus: 'Yes',
      groundwaterMigrationStatus: 'Yes',
      constructionComplete: 'Yes',
      sitewideReadyForUse: 'No'
    });
  });

  it('returns an empty medium list for a site with no contaminant data', async () => {
    await prisma.site.create({
      data: {
        semsSiteId: '0100460',
        epaId: 'CTD000000460',
        name: 'BARE SITE',
        state: 'CT',
        latitude: 41.5,
        longitude: -72.5,
        nplStatusCode: 'P',
        nplStatusName: 'Proposed for NPL',
        profileUrl: 'https://example.invalid/bare'
      }
    });
    const detail = await siteDetail(prisma, 'CTD000000460');
    expect(detail?.contaminantsByMedium).toEqual([]);
    expect(detail?.humanExposureStatus).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/lib/server/queries.test.ts`
Expected: FAIL — cannot resolve `./queries`.

- [ ] **Step 3: Implement the query layer**

```ts
// src/lib/server/queries.ts
import type { PrismaClient } from '@prisma/client';

export type SitePinProperties = {
  epaId: string;
  semsSiteId: string;
  name: string;
  city: string | null;
  state: string;
  nplStatusCode: string;
  nplStatusName: string;
  humanExposureStatus: string | null;
};

export type SiteFeature = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: SitePinProperties;
};

export type SiteFeatureCollection = {
  type: 'FeatureCollection';
  features: SiteFeature[];
};

export type SiteDetail = {
  epaId: string;
  semsSiteId: string;
  name: string;
  streetAddress: string | null;
  supplementalAddress: string | null;
  city: string | null;
  county: string | null;
  state: string;
  zip: string | null;
  latitude: number;
  longitude: number;
  epaRegion: string | null;
  nplStatusName: string;
  nplStatusCode: string;
  federalFacility: boolean;
  humanExposureStatus: string | null;
  groundwaterMigrationStatus: string | null;
  constructionComplete: string | null;
  sitewideReadyForUse: string | null;
  profileUrl: string;
  contaminantsByMedium: Array<{ medium: string; contaminants: string[] }>;
};

/**
 * Every site as one GeoJSON FeatureCollection. At 1,840 features this is a few
 * hundred kilobytes, so the map loads it once instead of fetching per viewport.
 *
 * GeoJSON coordinate order is [longitude, latitude] — the opposite of how the
 * rest of this codebase writes points.
 */
export async function sitesGeoJson(prisma: PrismaClient): Promise<SiteFeatureCollection> {
  const sites = await prisma.site.findMany({
    select: {
      epaId: true,
      semsSiteId: true,
      name: true,
      city: true,
      state: true,
      latitude: true,
      longitude: true,
      nplStatusCode: true,
      nplStatusName: true,
      humanExposureStatus: true
    }
  });

  return {
    type: 'FeatureCollection',
    features: sites.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] },
      properties: {
        epaId: s.epaId,
        semsSiteId: s.semsSiteId,
        name: s.name,
        city: s.city,
        state: s.state,
        nplStatusCode: s.nplStatusCode,
        nplStatusName: s.nplStatusName,
        humanExposureStatus: s.humanExposureStatus
      }
    }))
  };
}

export async function siteDetail(
  prisma: PrismaClient,
  epaId: string
): Promise<SiteDetail | null> {
  const site = await prisma.site.findUnique({
    where: { epaId },
    include: { contaminants: { include: { contaminant: true } } }
  });
  if (!site) return null;

  const byMedium = new Map<string, Set<string>>();
  for (const link of site.contaminants) {
    if (!byMedium.has(link.media)) byMedium.set(link.media, new Set());
    byMedium.get(link.media)!.add(link.contaminant.name);
  }

  const contaminantsByMedium = [...byMedium.entries()]
    .map(([medium, names]) => ({ medium, contaminants: [...names].sort() }))
    .sort((a, b) => a.medium.localeCompare(b.medium));

  return {
    epaId: site.epaId,
    semsSiteId: site.semsSiteId,
    name: site.name,
    streetAddress: site.streetAddress,
    supplementalAddress: site.supplementalAddress,
    city: site.city,
    county: site.county,
    state: site.state,
    zip: site.zip,
    latitude: site.latitude,
    longitude: site.longitude,
    epaRegion: site.epaRegion,
    nplStatusName: site.nplStatusName,
    nplStatusCode: site.nplStatusCode,
    federalFacility: site.federalFacility,
    humanExposureStatus: site.humanExposureStatus,
    groundwaterMigrationStatus: site.groundwaterMigrationStatus,
    constructionComplete: site.constructionComplete,
    sitewideReadyForUse: site.sitewideReadyForUse,
    profileUrl: site.profileUrl,
    contaminantsByMedium
  };
}
```

- [ ] **Step 4: Run the queries test to verify it passes**

Run: `pnpm test src/lib/server/queries.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Write the failing search test**

```ts
// src/lib/server/search.test.ts
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchSites } from './search';

let prisma: PrismaClient;
let dir: string;

const WHITE_HOUSE = {
  latitude: 38.898699,
  longitude: -77.035188,
  matchedAddress: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500',
  provider: 'census'
};

const geocoderImpl = vi.fn(async () => WHITE_HOUSE);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'etm-search-'));
  const url = `file:${join(dir, 'test.db')}`;
  execSync('pnpm exec prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url } });
  prisma = new PrismaClient({ datasources: { db: { url } } });
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.siteContaminant.deleteMany();
  await prisma.site.deleteMany();
  await prisma.geocodeCache.deleteMany();
  geocoderImpl.mockClear();

  // ~4 mi, ~7 mi, and ~690 mi from the White House.
  await prisma.site.createMany({
    data: [
      mkSite('0100001', 'NEAR SITE', 38.9601, -77.035188),
      mkSite('0100002', 'MID SITE', 39.0, -77.035188),
      mkSite('0100003', 'DISTANT SITE', 48.9, -77.035188)
    ]
  });
});

function mkSite(semsSiteId: string, name: string, latitude: number, longitude: number) {
  return {
    semsSiteId,
    epaId: `E${semsSiteId}`,
    name,
    state: 'DC',
    latitude,
    longitude,
    nplStatusCode: 'F',
    nplStatusName: 'Currently on the Final NPL',
    humanExposureStatus: 'Yes',
    profileUrl: `https://example.invalid/${semsSiteId}`
  };
}

describe('searchSites', () => {
  it('returns sites inside the radius, nearest first', async () => {
    const r = await searchSites(prisma, { address: '1600 Pennsylvania Ave NW', radiusMiles: 25 }, { geocoderImpl });
    expect(r.results.map((x) => x.name)).toEqual(['NEAR SITE', 'MID SITE']);
    expect(r.outsideRadius).toBe(false);
    expect(r.radiusMiles).toBe(25);
  });

  it('echoes the geocoded point and matched address', async () => {
    const r = await searchSites(prisma, { address: 'x', radiusMiles: 25 }, { geocoderImpl });
    expect(r.point.latitude).toBeCloseTo(38.898699, 5);
    expect(r.point.longitude).toBeCloseTo(-77.035188, 5);
    expect(r.point.matchedAddress).toContain('PENNSYLVANIA');
  });

  it('attaches an ascending distance to each result', async () => {
    const r = await searchSites(prisma, { address: 'x', radiusMiles: 25 }, { geocoderImpl });
    expect(r.results[0].distanceMiles).toBeLessThan(r.results[1].distanceMiles);
    expect(r.results[0].distanceMiles).toBeGreaterThan(0);
  });

  it('excludes sites outside the radius', async () => {
    const r = await searchSites(prisma, { address: 'x', radiusMiles: 5 }, { geocoderImpl });
    expect(r.results.map((x) => x.name)).toEqual(['NEAR SITE']);
  });

  it('falls back to the three nearest when the radius is empty', async () => {
    await prisma.site.deleteMany({ where: { semsSiteId: { in: ['0100001', '0100002'] } } });
    const r = await searchSites(prisma, { address: 'x', radiusMiles: 25 }, { geocoderImpl });
    expect(r.outsideRadius).toBe(true);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].name).toBe('DISTANT SITE');
    expect(r.results[0].distanceMiles).toBeGreaterThan(600);
  });

  it('caps the fallback at three sites', async () => {
    await prisma.site.deleteMany();
    await prisma.site.createMany({
      data: Array.from({ length: 6 }, (_, i) =>
        mkSite(`020000${i}`, `FAR ${i}`, 48 + i, -77.035188)
      )
    });
    const r = await searchSites(prisma, { address: 'x', radiusMiles: 25 }, { geocoderImpl });
    expect(r.outsideRadius).toBe(true);
    expect(r.results).toHaveLength(3);
  });

  it('returns an empty result set when the database has no sites at all', async () => {
    await prisma.site.deleteMany();
    const r = await searchSites(prisma, { address: 'x', radiusMiles: 25 }, { geocoderImpl });
    expect(r.results).toEqual([]);
    expect(r.outsideRadius).toBe(true);
  });

  it('defaults to a 25 mile radius when none is supplied', async () => {
    const r = await searchSites(prisma, { address: 'x' }, { geocoderImpl });
    expect(r.radiusMiles).toBe(25);
  });

  it('rejects a radius that is not an allowed option', async () => {
    await expect(
      searchSites(prisma, { address: 'x', radiusMiles: 37 }, { geocoderImpl })
    ).rejects.toThrow(/radius/i);
  });

  it('finds Guam sites from a Guam address, proving no CONUS filter exists', async () => {
    await prisma.site.deleteMany();
    await prisma.site.create({ data: mkSite('0900001', 'ORDOT LANDFILL', 13.439169, 144.897361) });
    const guam = vi.fn(async () => ({
      latitude: 13.47,
      longitude: 144.75,
      matchedAddress: 'HAGATNA, GU',
      provider: 'census'
    }));
    const r = await searchSites(prisma, { address: 'Hagatna, Guam', radiusMiles: 25 }, { geocoderImpl: guam });
    expect(r.outsideRadius).toBe(false);
    expect(r.results.map((x) => x.name)).toEqual(['ORDOT LANDFILL']);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm test src/lib/server/search.test.ts`
Expected: FAIL — cannot resolve `./search`.

- [ ] **Step 7: Implement search**

```ts
// src/lib/server/search.ts
import type { PrismaClient } from '@prisma/client';
import { boundingBox } from '$lib/geo/bbox';
import { geocode, type GeocodeOptions } from './geocode';
import {
  DEFAULT_RADIUS_MILES,
  isValidRadius,
  nearest,
  withinRadius,
  type Ranked
} from './proximity';

export const NEAREST_FALLBACK_COUNT = 3;

export type SearchResult = Ranked<{
  epaId: string;
  semsSiteId: string;
  name: string;
  city: string | null;
  state: string;
  latitude: number;
  longitude: number;
  nplStatusName: string;
  nplStatusCode: string;
  humanExposureStatus: string | null;
}>;

export type SearchResponse = {
  point: { latitude: number; longitude: number; matchedAddress: string };
  radiusMiles: number;
  outsideRadius: boolean;
  results: SearchResult[];
};

const SELECT = {
  epaId: true,
  semsSiteId: true,
  name: true,
  city: true,
  state: true,
  latitude: true,
  longitude: true,
  nplStatusName: true,
  nplStatusCode: true,
  humanExposureStatus: true
} as const;

/**
 * Geocode an address, then rank sites by straight-line distance.
 *
 * A bounding-box query narrows candidates using the (latitude, longitude)
 * index; the exact radius test happens in JS. When nothing falls inside the
 * radius we report the nearest few instead, which is the useful answer.
 */
export async function searchSites(
  prisma: PrismaClient,
  params: { address: string; radiusMiles?: number },
  opts: GeocodeOptions = {}
): Promise<SearchResponse> {
  const radiusMiles = params.radiusMiles ?? DEFAULT_RADIUS_MILES;
  if (!isValidRadius(radiusMiles)) {
    throw new Error(`Unsupported radius: ${radiusMiles}`);
  }

  const point = await geocode(prisma, params.address, opts);
  const box = boundingBox(point, radiusMiles);

  const longitudeFilter = box.wrapsAntimeridian
    ? { OR: [{ longitude: { gte: box.minLongitude } }, { longitude: { lte: box.maxLongitude } }] }
    : { longitude: { gte: box.minLongitude, lte: box.maxLongitude } };

  const candidates = await prisma.site.findMany({
    where: {
      latitude: { gte: box.minLatitude, lte: box.maxLatitude },
      ...longitudeFilter
    },
    select: SELECT
  });

  const inRadius = withinRadius(point, candidates, radiusMiles);

  if (inRadius.length > 0) {
    return {
      point: {
        latitude: point.latitude,
        longitude: point.longitude,
        matchedAddress: point.matchedAddress
      },
      radiusMiles,
      outsideRadius: false,
      results: inRadius
    };
  }

  // Nothing nearby. Scan every site for the closest few — an honest answer
  // beats an empty list, and 1,840 rows is a trivial scan.
  const all = await prisma.site.findMany({ select: SELECT });

  return {
    point: {
      latitude: point.latitude,
      longitude: point.longitude,
      matchedAddress: point.matchedAddress
    },
    radiusMiles,
    outsideRadius: true,
    results: nearest(point, all, NEAREST_FALLBACK_COUNT)
  };
}
```

- [ ] **Step 8: Run the search test to verify it passes**

Run: `pnpm test src/lib/server/search.test.ts`
Expected: 10 tests PASS.

- [ ] **Step 9: Write the three route handlers**

`src/routes/api/sites/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { sitesGeoJson } from '$lib/server/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const fc = await sitesGeoJson(prisma);
  return json(fc, {
    // The dataset changes only when the downloader runs.
    headers: { 'cache-control': 'public, max-age=3600' }
  });
};
```

`src/routes/api/sites/[epaId]/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { siteDetail } from '$lib/server/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const detail = await siteDetail(prisma, params.epaId);
  if (!detail) throw error(404, 'Site not found');
  return json(detail);
};
```

`src/routes/api/search/+server.ts` — this is where the error classes become HTTP statuses:

```ts
import { error, json } from '@sveltejs/kit';
import { GeocodeNotFoundError, GeocoderUnavailableError } from '$lib/server/geocode';
import { prisma } from '$lib/server/prisma';
import { DEFAULT_RADIUS_MILES, isValidRadius } from '$lib/server/proximity';
import { searchSites } from '$lib/server/search';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  let body: { address?: unknown; radiusMiles?: unknown };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Request body must be JSON');
  }

  const address = typeof body.address === 'string' ? body.address.trim() : '';
  if (address === '') throw error(400, 'Please enter an address');

  const radiusMiles = body.radiusMiles ?? DEFAULT_RADIUS_MILES;
  if (!isValidRadius(radiusMiles)) throw error(400, 'Unsupported search radius');

  try {
    return json(await searchSites(prisma, { address, radiusMiles }));
  } catch (err) {
    if (err instanceof GeocodeNotFoundError) {
      throw error(422, "We couldn't find that address. Try adding a city and state.");
    }
    if (err instanceof GeocoderUnavailableError) {
      throw error(503, 'The address lookup service is unavailable. Please try again.');
    }
    throw err;
  }
};
```

- [ ] **Step 10: Verify the routes against the real database**

Run: `pnpm dev` in one terminal, then in another:

```bash
curl -s localhost:5173/api/sites | head -c 300; echo
curl -s localhost:5173/api/sites | python3 -c 'import json,sys; print("features:", len(json.load(sys.stdin)["features"]))'
curl -s localhost:5173/api/sites/CTD001153923 | python3 -m json.tool | head -30
curl -s -X POST localhost:5173/api/search -H 'content-type: application/json' \
  -d '{"address":"1600 Pennsylvania Avenue NW, Washington, DC","radiusMiles":25}' | python3 -m json.tool
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:5173/api/search \
  -H 'content-type: application/json' -d '{"address":"zzzzz not an address zzzzz"}'
```

Expected: `features: 1840`; a full detail object with grouped contaminants; a search result with real DC-area sites and ascending distances; and `422` for the nonsense address.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add GeoJSON, site detail, and address search API routes"
```

---

## Task 13: Status colours, radius circle, and the map

**Files:**
- Create: `src/lib/statusColors.ts`, `src/lib/geo/circle.ts`, `src/lib/components/Map.svelte`, `src/lib/components/Legend.svelte`
- Test: `src/lib/statusColors.test.ts`, `src/lib/geo/circle.test.ts`

**Interfaces:**
- Consumes: `SiteFeatureCollection` from `$lib/server/queries` (type only), `LatLng` from `$lib/geo/types`.
- Produces:
  - `EXPOSURE_COLORS`, `exposureColor(status)`, `EXPOSURE_LEGEND`, `MAPLIBRE_COLOR_EXPRESSION`
  - `circlePolygon(center, radiusMiles, steps?)` → GeoJSON `Feature<Polygon>`
  - `Map.svelte` props: `{ features, searchPoint, radiusMiles, selectedEpaId, onSelect }`
  - `Legend.svelte` — no props

**Visual direction.** The palette is functional, not decorative: a near-white paper ground so pins carry all the colour, one accent (slate-900) for chrome, and the four status colours reserved exclusively for data. Nothing else on the page is allowed to be green, red, or amber, so those hues always mean exposure status. Type is the system UI stack at two sizes only — 13px for data rows, 15px for prose — because a data tool should look calm, not designed.

- [ ] **Step 1: Write the failing status-colours test**

```ts
// src/lib/statusColors.test.ts
import { describe, expect, it } from 'vitest';
import {
  EXPOSURE_LEGEND,
  MAPLIBRE_COLOR_EXPRESSION,
  exposureColor,
  UNKNOWN_COLOR
} from './statusColors';

describe('exposureColor', () => {
  it('maps every verified status value', () => {
    expect(exposureColor('Yes')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(exposureColor('No')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(exposureColor('Insufficient Data')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('gives every status a distinct colour', () => {
    const colors = ['Yes', 'No', 'Insufficient Data'].map(exposureColor);
    expect(new Set(colors).size).toBe(3);
  });

  it('falls back to the unknown colour for null', () => {
    expect(exposureColor(null)).toBe(UNKNOWN_COLOR);
  });

  it('falls back for Status Unavailable and any future unseen value', () => {
    expect(exposureColor('Status Unavailable')).toBe(UNKNOWN_COLOR);
    expect(exposureColor('Something EPA Invents In 2027')).toBe(UNKNOWN_COLOR);
  });

  it('is case-insensitive, since EPA capitalisation is inconsistent', () => {
    expect(exposureColor('yes')).toBe(exposureColor('Yes'));
    expect(exposureColor('INSUFFICIENT DATA')).toBe(exposureColor('Insufficient Data'));
  });
});

describe('EXPOSURE_LEGEND', () => {
  it('documents four entries with labels and colours', () => {
    expect(EXPOSURE_LEGEND).toHaveLength(4);
    for (const entry of EXPOSURE_LEGEND) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('MAPLIBRE_COLOR_EXPRESSION', () => {
  it('is a match expression keyed on humanExposureStatus with a fallback', () => {
    expect(MAPLIBRE_COLOR_EXPRESSION[0]).toBe('match');
    expect(JSON.stringify(MAPLIBRE_COLOR_EXPRESSION)).toContain('humanExposureStatus');
    // A match expression's final element is the default.
    expect(MAPLIBRE_COLOR_EXPRESSION.at(-1)).toBe(UNKNOWN_COLOR);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/lib/statusColors.test.ts`
Expected: FAIL — cannot resolve `./statusColors`.

- [ ] **Step 3: Implement status colours**

```ts
// src/lib/statusColors.ts

/**
 * Colour per verified Human Exposure Under Control value. These four hues are
 * reserved for exposure status and used nowhere else in the UI, so colour
 * always carries the same meaning.
 */
export const EXPOSURE_COLORS = {
  yes: '#15803d',
  no: '#b91c1c',
  'insufficient data': '#b45309'
} as const;

/** Used for `Status Unavailable`, null, and any value EPA adds later. */
export const UNKNOWN_COLOR = '#57534e';

export function exposureColor(status: string | null | undefined): string {
  if (!status) return UNKNOWN_COLOR;
  const key = status.trim().toLowerCase() as keyof typeof EXPOSURE_COLORS;
  return EXPOSURE_COLORS[key] ?? UNKNOWN_COLOR;
}

export const EXPOSURE_LEGEND = [
  { label: 'Human exposure under control', color: EXPOSURE_COLORS.yes },
  { label: 'Not under control', color: EXPOSURE_COLORS.no },
  { label: 'Insufficient data', color: EXPOSURE_COLORS['insufficient data'] },
  { label: 'Not reported', color: UNKNOWN_COLOR }
] as const;

/**
 * MapLibre `match` expression over the feature's humanExposureStatus property.
 * Case variants are listed explicitly because MapLibre has no lowercase
 * operator for property values.
 */
export const MAPLIBRE_COLOR_EXPRESSION = [
  'match',
  ['get', 'humanExposureStatus'],
  ['Yes', 'yes'],
  EXPOSURE_COLORS.yes,
  ['No', 'no'],
  EXPOSURE_COLORS.no,
  ['Insufficient Data', 'Insufficient data', 'insufficient data'],
  EXPOSURE_COLORS['insufficient data'],
  UNKNOWN_COLOR
] as unknown[];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/statusColors.test.ts`
Expected: 8 tests PASS.

- [ ] **Step 5: Write the failing circle test**

```ts
// src/lib/geo/circle.test.ts
import { describe, expect, it } from 'vitest';
import { circlePolygon } from './circle';
import { haversineMiles } from './haversine';

const MIAMI = { latitude: 25.7617, longitude: -80.1918 };
const ANCHORAGE = { latitude: 61.2181, longitude: -149.9003 };

describe('circlePolygon', () => {
  it('produces a closed GeoJSON polygon', () => {
    const f = circlePolygon(MIAMI, 25);
    expect(f.type).toBe('Feature');
    expect(f.geometry.type).toBe('Polygon');
    const ring = f.geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('places every vertex at the requested radius', () => {
    const ring = circlePolygon(MIAMI, 25).geometry.coordinates[0];
    for (const [lon, lat] of ring) {
      expect(haversineMiles(MIAMI, { latitude: lat, longitude: lon })).toBeCloseTo(25, 0);
    }
  });

  it('stays accurate at high latitude', () => {
    const ring = circlePolygon(ANCHORAGE, 50).geometry.coordinates[0];
    for (const [lon, lat] of ring) {
      expect(haversineMiles(ANCHORAGE, { latitude: lat, longitude: lon })).toBeCloseTo(50, 0);
    }
  });

  it('emits coordinates as [longitude, latitude]', () => {
    const [lon, lat] = circlePolygon(MIAMI, 10).geometry.coordinates[0][0];
    expect(Math.abs(lon)).toBeGreaterThan(70);
    expect(Math.abs(lat)).toBeLessThan(40);
  });

  it('honours the step count', () => {
    expect(circlePolygon(MIAMI, 10, 32).geometry.coordinates[0]).toHaveLength(33);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm test src/lib/geo/circle.test.ts`
Expected: FAIL — cannot resolve `./circle`.

- [ ] **Step 7: Implement the circle**

```ts
// src/lib/geo/circle.ts
import { EARTH_RADIUS_MILES } from './haversine';
import type { LatLng } from './types';

export type CircleFeature = {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
};

const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;

/**
 * A polygon approximating the circle of `radiusMiles` around `center`, for
 * drawing the search radius. Uses the destination-point formula rather than a
 * flat offset so the shape stays a true circle on the ground at any latitude.
 */
export function circlePolygon(
  center: LatLng,
  radiusMiles: number,
  steps = 64
): CircleFeature {
  const angular = radiusMiles / EARTH_RADIUS_MILES;
  const lat1 = toRad(center.latitude);
  const lon1 = toRad(center.longitude);
  const ring: [number, number][] = [];

  for (let i = 0; i <= steps; i += 1) {
    const bearing = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
      );
    ring.push([toDeg(lon2), toDeg(lat2)]);
  }

  // Close the ring exactly, so no floating-point gap remains.
  ring[ring.length - 1] = ring[0];

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] }
  };
}
```

- [ ] **Step 8: Run the circle test to verify it passes**

Run: `pnpm test src/lib/geo/circle.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 9: Write `Legend.svelte`**

```svelte
<!-- src/lib/components/Legend.svelte -->
<script lang="ts">
  import { EXPOSURE_LEGEND } from '$lib/statusColors';
</script>

<div
  class="pointer-events-none absolute bottom-3 right-3 rounded-md border border-stone-300 bg-white/95 p-3 shadow-sm"
>
  <p class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
    Human exposure
  </p>
  <ul class="space-y-1">
    {#each EXPOSURE_LEGEND as entry (entry.label)}
      <li class="flex items-center gap-2 text-[13px] text-stone-700">
        <span
          class="inline-block size-3 rounded-full border border-black/20"
          style:background-color={entry.color}
        ></span>
        {entry.label}
      </li>
    {/each}
  </ul>
  <p class="mt-2 max-w-44 text-[11px] leading-snug text-stone-500">
    Hollow ring = deleted from the NPL
  </p>
</div>
```

- [ ] **Step 10: Write `Map.svelte`**

Svelte 5 runes. The component owns the MapLibre instance and nothing else: it renders whatever features it is handed and calls `onSelect` when a pin is clicked.

```svelte
<!-- src/lib/components/Map.svelte -->
<script lang="ts">
  import { circlePolygon } from '$lib/geo/circle';
  import type { LatLng } from '$lib/geo/types';
  import type { SiteFeatureCollection } from '$lib/server/queries';
  import { MAPLIBRE_COLOR_EXPRESSION } from '$lib/statusColors';
  import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
  import Legend from './Legend.svelte';

  type Props = {
    features: SiteFeatureCollection;
    searchPoint?: (LatLng & { matchedAddress: string }) | null;
    radiusMiles?: number;
    onSelect?: (epaId: string) => void;
  };

  let { features, searchPoint = null, radiusMiles = 25, onSelect }: Props = $props();

  const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
  const EMPTY = { type: 'FeatureCollection' as const, features: [] };
  // Whole-US view including Alaska, Hawaii, and the territories.
  const INITIAL = { center: [-98.5, 39.8] as [number, number], zoom: 3.2 };

  let container: HTMLDivElement;
  let map: MapLibreMap | null = null;
  let ready = $state(false);

  function addLayers(m: MapLibreMap): void {
    m.addSource('sites', {
      type: 'geojson',
      data: features,
      cluster: true,
      clusterRadius: 44,
      clusterMaxZoom: 9
    });
    m.addSource('radius', { type: 'geojson', data: EMPTY });
    m.addSource('origin', { type: 'geojson', data: EMPTY });

    m.addLayer({
      id: 'radius-fill',
      type: 'fill',
      source: 'radius',
      paint: { 'fill-color': '#0f172a', 'fill-opacity': 0.06 }
    });
    m.addLayer({
      id: 'radius-line',
      type: 'line',
      source: 'radius',
      paint: { 'line-color': '#0f172a', 'line-width': 1.5, 'line-dasharray': [2, 2] }
    });

    m.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'sites',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#0f172a',
        'circle-opacity': 0.85,
        'circle-radius': ['step', ['get', 'point_count'], 14, 25, 19, 100, 25]
      }
    });
    m.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'sites',
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
      paint: { 'text-color': '#ffffff' }
    });

    m.addLayer({
      id: 'site-pins',
      type: 'circle',
      source: 'sites',
      filter: ['!', ['has', 'point_count']],
      paint: {
        // Deleted sites render hollow so colour is not the only channel.
        'circle-color': [
          'case',
          ['==', ['get', 'nplStatusCode'], 'D'],
          '#ffffff',
          MAPLIBRE_COLOR_EXPRESSION
        ],
        'circle-radius': 6,
        'circle-stroke-width': 2,
        'circle-stroke-color': MAPLIBRE_COLOR_EXPRESSION
      }
    });

    m.addLayer({
      id: 'origin-pin',
      type: 'circle',
      source: 'origin',
      paint: {
        'circle-color': '#0f172a',
        'circle-radius': 7,
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff'
      }
    });

    m.on('click', 'site-pins', (e) => {
      const epaId = e.features?.[0]?.properties?.epaId;
      if (typeof epaId === 'string') onSelect?.(epaId);
    });
    m.on('click', 'clusters', (e) => {
      const zoom = m.getZoom();
      m.easeTo({ center: (e.lngLat as maplibregl.LngLat), zoom: zoom + 2 });
    });
    for (const layer of ['site-pins', 'clusters']) {
      m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
    }
  }

  $effect(() => {
    const m = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: INITIAL.center,
      zoom: INITIAL.zoom,
      attributionControl: { compact: true }
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      addLayers(m);
      map = m;
      ready = true;
    });

    return () => {
      ready = false;
      map = null;
      m.remove();
    };
  });

  // Keep the pin source in sync when the feature collection changes.
  $effect(() => {
    if (!ready || !map) return;
    (map.getSource('sites') as maplibregl.GeoJSONSource | undefined)?.setData(features);
  });

  // Draw the radius and origin, and fly to the searched address.
  $effect(() => {
    if (!ready || !map) return;
    const radius = map.getSource('radius') as maplibregl.GeoJSONSource | undefined;
    const origin = map.getSource('origin') as maplibregl.GeoJSONSource | undefined;

    if (!searchPoint) {
      radius?.setData(EMPTY);
      origin?.setData(EMPTY);
      return;
    }

    radius?.setData(circlePolygon(searchPoint, radiusMiles) as never);
    origin?.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [searchPoint.longitude, searchPoint.latitude]
          }
        }
      ]
    } as never);

    // Zoom so the whole radius circle fits, roughly.
    const zoom = radiusMiles <= 5 ? 11 : radiusMiles <= 10 ? 10 : radiusMiles <= 25 ? 9 : radiusMiles <= 50 ? 8 : 7;
    map.flyTo({ center: [searchPoint.longitude, searchPoint.latitude], zoom, duration: 900 });
  });
</script>

<div class="relative size-full">
  <!-- The canvas is not screen-reader navigable; ResultsList is the accessible path. -->
  <div bind:this={container} aria-hidden="true" class="size-full" data-testid="map"></div>
  <Legend />
</div>
```

- [ ] **Step 11: Verify the map renders**

Temporarily point `src/routes/+page.svelte` at the map so you can see it:

```svelte
<script lang="ts">
  import Map from '$lib/components/Map.svelte';
  import { onMount } from 'svelte';
  let features = $state({ type: 'FeatureCollection' as const, features: [] });
  onMount(async () => {
    features = await (await fetch('/api/sites')).json();
  });
</script>

<div class="h-screen w-screen">
  <Map {features} onSelect={(id) => console.log('selected', id)} />
</div>
```

Run: `pnpm dev`, open the printed URL.
Expected: a US basemap, clustered dark circles that break into coloured pins as you zoom, mostly green with scattered red and amber, hollow rings for deleted sites, a legend bottom-right, and `selected <epaId>` in the console when you click a pin. Pan and zoom should feel native.

If tiles do not load, check the browser console — OpenFreeMap has no SLA. Swap `STYLE_URL` for another keyless style rather than adding a token.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: add MapLibre map with clustered status-coloured pins and legend"
```

---

## Task 14: Search form, results list, and page assembly

**Files:**
- Create: `src/lib/components/AddressSearch.svelte`, `src/lib/components/ResultsList.svelte`
- Modify: `src/routes/+page.svelte` (replace the Task 13 scaffold entirely)
- Test: covered by Task 15's E2E spec; no unit test — these components hold no logic worth isolating

**Interfaces:**
- Consumes: `RADIUS_OPTIONS`/`DEFAULT_RADIUS_MILES` from `$lib/server/proximity`, `SearchResponse`/`SearchResult` from `$lib/server/search` (types only), `exposureColor` from `$lib/statusColors`, `Map.svelte`.
- Produces:
  - `AddressSearch.svelte` props: `{ address, radiusMiles, loading, onSubmit }`
  - `ResultsList.svelte` props: `{ response, loading, errorMessage, selectedEpaId, onSelect }`
  - `+page.svelte` owns all search state and is the only thing that calls `fetch`.

**Note on importing from `$lib/server`:** importing *types* is fine — they vanish at compile time. `RADIUS_OPTIONS` and `DEFAULT_RADIUS_MILES` are runtime values in `$lib/server/proximity`, and SvelteKit forbids client code importing from `$lib/server`. Move those two constants to a new `src/lib/radius.ts` and re-export them from `proximity.ts` so both sides can use them.

- [ ] **Step 1: Extract the radius constants so the client can import them**

Create `src/lib/radius.ts`:

```ts
export const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
export const DEFAULT_RADIUS_MILES = 25;
```

Then in `src/lib/server/proximity.ts`, replace the two local declarations with a re-export:

```ts
import { DEFAULT_RADIUS_MILES, RADIUS_OPTIONS } from '$lib/radius';
export { DEFAULT_RADIUS_MILES, RADIUS_OPTIONS };
```

Run: `pnpm test src/lib/server/proximity.test.ts`
Expected: still 11 PASS — the test imports from `./proximity` and the re-export keeps that working.

- [ ] **Step 2: Write `AddressSearch.svelte`**

```svelte
<!-- src/lib/components/AddressSearch.svelte -->
<script lang="ts">
  import { RADIUS_OPTIONS } from '$lib/radius';

  type Props = {
    address: string;
    radiusMiles: number;
    loading?: boolean;
    onSubmit: (address: string, radiusMiles: number) => void;
  };

  let { address = $bindable(), radiusMiles = $bindable(), loading = false, onSubmit }: Props =
    $props();

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (address.trim() === '') return;
    onSubmit(address, radiusMiles);
  }
</script>

<form onsubmit={submit} class="flex flex-wrap items-center gap-2">
  <label class="sr-only" for="address">Street address, city, and state</label>
  <input
    id="address"
    name="address"
    type="text"
    autocomplete="street-address"
    placeholder="1600 Pennsylvania Ave NW, Washington, DC"
    bind:value={address}
    class="min-w-64 flex-1 rounded-md border border-stone-300 px-3 py-2 text-[15px] outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
  />

  <label class="sr-only" for="radius">Search radius in miles</label>
  <select
    id="radius"
    bind:value={radiusMiles}
    class="rounded-md border border-stone-300 bg-white px-2 py-2 text-[15px] outline-none focus:border-slate-900"
  >
    {#each RADIUS_OPTIONS as option (option)}
      <option value={option}>{option} mi</option>
    {/each}
  </select>

  <button
    type="submit"
    disabled={loading || address.trim() === ''}
    class="rounded-md bg-slate-900 px-4 py-2 text-[15px] font-medium text-white disabled:opacity-40"
  >
    {loading ? 'Searching…' : 'Search'}
  </button>
</form>
```

- [ ] **Step 3: Write `ResultsList.svelte`**

This is the accessible path to the whole dataset, so every row is a real button and the count is announced.

```svelte
<!-- src/lib/components/ResultsList.svelte -->
<script lang="ts">
  import type { SearchResponse } from '$lib/server/search';
  import { exposureColor } from '$lib/statusColors';

  type Props = {
    response: SearchResponse | null;
    loading?: boolean;
    errorMessage?: string | null;
    selectedEpaId?: string | null;
    onSelect: (epaId: string) => void;
  };

  let { response, loading = false, errorMessage = null, selectedEpaId = null, onSelect }: Props =
    $props();

  let heading = $derived.by(() => {
    if (!response) return '';
    const n = response.results.length;
    if (response.outsideRadius) {
      return n === 0
        ? 'No Superfund sites found'
        : `Nothing within ${response.radiusMiles} miles — closest ${n === 1 ? 'site' : `${n} sites`}`;
    }
    return `${n} ${n === 1 ? 'site' : 'sites'} within ${response.radiusMiles} miles`;
  });
</script>

<section class="flex h-full flex-col border-r border-stone-200 bg-white">
  <div aria-live="polite" class="border-b border-stone-200 px-4 py-3">
    {#if loading}
      <p class="text-[13px] text-stone-500">Looking up that address…</p>
    {:else if errorMessage}
      <p class="text-[13px] text-red-700">{errorMessage}</p>
    {:else if response}
      <p class="text-[15px] font-semibold text-stone-900">{heading}</p>
      <p class="mt-0.5 text-[12px] text-stone-500">
        Straight-line distance from {response.point.matchedAddress}
      </p>
    {:else}
      <p class="text-[13px] text-stone-500">
        Enter an address to see the Superfund sites nearest to it.
      </p>
    {/if}
  </div>

  {#if response && response.results.length > 0}
    <ul class="flex-1 overflow-y-auto">
      {#each response.results as site (site.epaId)}
        <li>
          <button
            type="button"
            onclick={() => onSelect(site.epaId)}
            aria-current={selectedEpaId === site.epaId ? 'true' : undefined}
            data-testid="result-row"
            class="flex w-full items-start gap-3 border-b border-stone-100 px-4 py-3 text-left hover:bg-stone-50 focus:bg-stone-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-slate-900 aria-[current]:bg-stone-100"
          >
            <span
              class="mt-1 inline-block size-3 shrink-0 rounded-full border border-black/20"
              style:background-color={exposureColor(site.humanExposureStatus)}
            ></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13px] font-medium text-stone-900">{site.name}</span>
              <span class="block text-[12px] text-stone-500">
                {site.city ? `${site.city}, ` : ''}{site.state} · {site.nplStatusName}
              </span>
            </span>
            <span class="shrink-0 text-[13px] tabular-nums text-stone-600">
              {site.distanceMiles} mi
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
```

- [ ] **Step 4: Rewrite `src/routes/+page.svelte`**

The page owns all state and is the only component that fetches. Note it loads pins via `onMount` rather than a `+page.server.ts` loader, so the 1,840-feature payload does not get inlined into the server-rendered HTML.

```svelte
<!-- src/routes/+page.svelte -->
<script lang="ts">
  import AddressSearch from '$lib/components/AddressSearch.svelte';
  import Map from '$lib/components/Map.svelte';
  import ResultsList from '$lib/components/ResultsList.svelte';
  import { DEFAULT_RADIUS_MILES } from '$lib/radius';
  import type { SiteFeatureCollection } from '$lib/server/queries';
  import type { SearchResponse } from '$lib/server/search';
  import { onMount } from 'svelte';

  let features = $state<SiteFeatureCollection>({ type: 'FeatureCollection', features: [] });
  let address = $state('');
  let radiusMiles = $state<number>(DEFAULT_RADIUS_MILES);
  let response = $state<SearchResponse | null>(null);
  let selectedEpaId = $state<string | null>(null);
  let loading = $state(false);
  let errorMessage = $state<string | null>(null);

  onMount(async () => {
    try {
      const res = await fetch('/api/sites');
      if (res.ok) features = await res.json();
    } catch {
      errorMessage = 'Could not load the Superfund site map.';
    }
  });

  async function search(nextAddress: string, nextRadius: number): Promise<void> {
    loading = true;
    errorMessage = null;
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: nextAddress, radiusMiles: nextRadius })
      });

      if (res.ok) {
        response = await res.json();
      } else {
        response = null;
        const body = await res.json().catch(() => null);
        errorMessage = body?.message ?? 'Something went wrong with that search.';
      }
    } catch {
      response = null;
      errorMessage = 'Could not reach the server. Check your connection and try again.';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Exposure Tracking Map — US Superfund sites near an address</title>
  <meta
    name="description"
    content="Find EPA National Priorities List Superfund sites near any US address, with contaminants of concern and human-exposure status."
  />
</svelte:head>

<div class="flex h-screen flex-col bg-stone-50 text-stone-900">
  <header class="flex flex-wrap items-center gap-4 border-b border-stone-200 bg-white px-4 py-3">
    <h1 class="text-[15px] font-semibold tracking-tight">Exposure Tracking Map</h1>
    <div class="flex-1">
      <AddressSearch bind:address bind:radiusMiles {loading} onSubmit={search} />
    </div>
  </header>

  <main class="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
    <div class="h-1/2 md:h-auto md:w-80 md:shrink-0">
      <ResultsList
        {response}
        {loading}
        {errorMessage}
        {selectedEpaId}
        onSelect={(id) => (selectedEpaId = id)}
      />
    </div>
    <div class="min-h-0 flex-1">
      <Map
        {features}
        {radiusMiles}
        searchPoint={response?.point ?? null}
        onSelect={(id) => (selectedEpaId = id)}
      />
    </div>
  </main>
</div>
```

`selectedEpaId` is set but not yet consumed — Task 15 wires it to the dialog.

- [ ] **Step 5: Verify the search flow end to end by hand**

Run: `pnpm dev`, then in the browser:

1. Search `1600 Pennsylvania Avenue NW, Washington, DC` at 25 mi → the map flies to DC, draws a dashed radius circle, and the list shows real sites with ascending distances.
2. Change the radius to 5 mi and search again → fewer results, tighter circle.
3. Search `Kaktovik, AK` at 5 mi → the "nothing within 5 miles" heading with up to three distant sites, and `outsideRadius` styling.
4. Search `zzzz not real zzzz` → the 422 message, "We couldn't find that address…", and no results.
5. Tab through the list → each row takes focus with a visible ring.
6. Narrow the window below `md` → the list moves below the map.

- [ ] **Step 6: Run the full test suite and type check**

Run: `pnpm test && pnpm check`
Expected: all tests pass; `svelte-check` reports 0 errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire address search, results list, and map into the page"
```

---

## Task 15: Site dialog, end-to-end test, and docs

**Files:**
- Create: `src/lib/components/SiteDialog.svelte`, `tests/e2e/search.spec.ts`, `tests/seed-fixture.ts`, `playwright.config.ts`, `src/lib/server/live.canary.test.ts`, `README.md`
- Modify: `src/routes/+page.svelte`

**Interfaces:**
- Consumes: `SiteDetail` from `$lib/server/queries` (type only), `exposureColor`, `selectedEpaId` state from the page.
- Produces: `SiteDialog.svelte` props `{ epaId, distanceMiles, onClose }`; a passing `pnpm test:e2e`; a `README.md` a stranger can follow.

- [ ] **Step 1: Write `SiteDialog.svelte`**

Native `<dialog>` with `showModal()` gives focus trapping and Escape handling for free — do not hand-roll either.

```svelte
<!-- src/lib/components/SiteDialog.svelte -->
<script lang="ts">
  import type { SiteDetail } from '$lib/server/queries';
  import { exposureColor } from '$lib/statusColors';

  type Props = {
    epaId: string | null;
    distanceMiles?: number | null;
    onClose: () => void;
  };

  let { epaId, distanceMiles = null, onClose }: Props = $props();

  let dialog: HTMLDialogElement;
  let detail = $state<SiteDetail | null>(null);
  let loading = $state(false);
  let failed = $state(false);

  $effect(() => {
    if (!epaId) {
      if (dialog?.open) dialog.close();
      detail = null;
      failed = false;
      return;
    }

    loading = true;
    failed = false;
    detail = null;
    if (!dialog.open) dialog.showModal();

    let cancelled = false;
    fetch(`/api/sites/${encodeURIComponent(epaId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: SiteDetail) => {
        if (!cancelled) detail = body;
      })
      .catch(() => {
        if (!cancelled) failed = true;
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });

    return () => {
      cancelled = true;
    };
  });

  const MEASURES = [
    { key: 'humanExposureStatus', label: 'Human exposure under control' },
    { key: 'groundwaterMigrationStatus', label: 'Groundwater migration under control' },
    { key: 'constructionComplete', label: 'Construction complete' },
    { key: 'sitewideReadyForUse', label: 'Sitewide ready for anticipated use' }
  ] as const;
</script>

<dialog
  bind:this={dialog}
  onclose={onClose}
  data-testid="site-dialog"
  class="w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-stone-300 p-0 backdrop:bg-slate-900/40"
>
  {#if loading}
    <p class="p-6 text-[13px] text-stone-500">Loading site details…</p>
  {:else if failed}
    <div class="p-6">
      <p class="text-[13px] text-red-700">Could not load details for this site.</p>
      <button type="button" onclick={() => dialog.close()} class="mt-4 text-[13px] underline">
        Close
      </button>
    </div>
  {:else if detail}
    <header class="flex items-start gap-3 border-b border-stone-200 px-6 py-4">
      <span
        class="mt-1.5 inline-block size-3.5 shrink-0 rounded-full border border-black/20"
        style:background-color={exposureColor(detail.humanExposureStatus)}
      ></span>
      <div class="min-w-0 flex-1">
        <h2 class="text-[15px] font-semibold leading-snug">{detail.name}</h2>
        <p class="mt-0.5 text-[12px] text-stone-500">
          {detail.nplStatusName}
          {#if detail.federalFacility}· Federal facility{/if}
          {#if distanceMiles !== null}· {distanceMiles} mi away{/if}
        </p>
      </div>
      <button
        type="button"
        onclick={() => dialog.close()}
        aria-label="Close site details"
        class="shrink-0 rounded px-2 py-1 text-stone-500 hover:bg-stone-100"
      >
        ✕
      </button>
    </header>

    <div class="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-4 text-[13px]">
      <section>
        <h3 class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Location
        </h3>
        <p class="text-stone-700">
          {#if detail.streetAddress}{detail.streetAddress}<br />{/if}
          {detail.city ? `${detail.city}, ` : ''}{detail.state}{detail.zip ? ` ${detail.zip}` : ''}
          {#if detail.county}<br />{detail.county} County{/if}
        </p>
        <p class="mt-1 text-[12px] text-stone-500">
          EPA ID {detail.epaId}{detail.epaRegion ? ` · Region ${detail.epaRegion}` : ''}
        </p>
      </section>

      <section>
        <h3 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Performance measures
        </h3>
        <dl class="divide-y divide-stone-100">
          {#each MEASURES as measure (measure.key)}
            <div class="flex items-baseline justify-between gap-4 py-1.5">
              <dt class="text-stone-600">{measure.label}</dt>
              <dd class="shrink-0 font-medium text-stone-900">
                {detail[measure.key] ?? 'Not reported'}
              </dd>
            </div>
          {/each}
        </dl>
      </section>

      <section>
        <h3 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Contaminants of concern
        </h3>
        {#if detail.contaminantsByMedium.length === 0}
          <p class="text-stone-500">No contaminant data reported for this site.</p>
        {:else}
          <div class="space-y-2" data-testid="contaminants">
            {#each detail.contaminantsByMedium as group (group.medium)}
              <div>
                <p class="font-medium text-stone-800">{group.medium}</p>
                <p class="text-stone-600">{group.contaminants.join(', ')}</p>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <a
        href={detail.profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-block text-[13px] font-medium text-slate-900 underline"
      >
        View EPA site profile ↗
      </a>
    </div>
  {/if}
</dialog>
```

- [ ] **Step 2: Wire the dialog into the page**

In `src/routes/+page.svelte`, add the import:

```ts
  import SiteDialog from '$lib/components/SiteDialog.svelte';
```

Add a derived distance so the dialog can show it only for search results:

```ts
  let selectedDistance = $derived(
    response?.results.find((r) => r.epaId === selectedEpaId)?.distanceMiles ?? null
  );
```

And render it just before the closing `</div>` of the outer wrapper:

```svelte
  <SiteDialog
    epaId={selectedEpaId}
    distanceMiles={selectedDistance}
    onClose={() => (selectedEpaId = null)}
  />
```

- [ ] **Step 3: Write the fixture seeder**

```ts
// tests/seed-fixture.ts
import { PrismaClient } from '@prisma/client';

/**
 * Deterministic dataset for the E2E test. Three sites near the White House at
 * known distances, one Guam site, and one site with no contaminant or measure
 * data, so the empty states are exercised too.
 */
export async function seedFixture(prisma: PrismaClient): Promise<void> {
  await prisma.siteContaminant.deleteMany();
  await prisma.contaminant.deleteMany();
  await prisma.site.deleteMany();
  await prisma.geocodeCache.deleteMany();
  await prisma.ingestRun.deleteMany();

  const base = {
    state: 'DC',
    nplStatusCode: 'F',
    nplStatusName: 'Currently on the Final NPL',
    city: 'WASHINGTON'
  };

  const near = await prisma.site.create({
    data: {
      ...base,
      semsSiteId: '9000001',
      epaId: 'TESTNEAR0001',
      name: 'FIXTURE NEAR SITE',
      streetAddress: '100 TEST WAY',
      county: 'DISTRICT OF COLUMBIA',
      zip: '20500',
      latitude: 38.9401,
      longitude: -77.035188,
      humanExposureStatus: 'Yes',
      groundwaterMigrationStatus: 'No',
      constructionComplete: 'Yes',
      sitewideReadyForUse: 'No',
      epaRegion: '03',
      profileUrl: 'https://example.invalid/near'
    }
  });

  await prisma.site.create({
    data: {
      ...base,
      semsSiteId: '9000002',
      epaId: 'TESTMID0002',
      name: 'FIXTURE MID SITE',
      latitude: 39.0,
      longitude: -77.035188,
      humanExposureStatus: 'Insufficient Data',
      profileUrl: 'https://example.invalid/mid'
    }
  });

  await prisma.site.create({
    data: {
      ...base,
      semsSiteId: '9000003',
      epaId: 'TESTBARE0003',
      name: 'FIXTURE BARE SITE',
      nplStatusCode: 'D',
      nplStatusName: 'Deleted from the Final NPL',
      latitude: 38.95,
      longitude: -77.05,
      profileUrl: 'https://example.invalid/bare'
    }
  });

  await prisma.site.create({
    data: {
      semsSiteId: '9000004',
      epaId: 'TESTGUAM0004',
      name: 'FIXTURE GUAM SITE',
      state: 'GU',
      city: 'HAGATNA',
      latitude: 13.439169,
      longitude: 144.897361,
      nplStatusCode: 'F',
      nplStatusName: 'Currently on the Final NPL',
      humanExposureStatus: 'No',
      profileUrl: 'https://example.invalid/guam'
    }
  });

  const tce = await prisma.contaminant.create({ data: { name: 'TRICHLOROETHENE' } });
  const lead = await prisma.contaminant.create({ data: { name: 'LEAD' } });
  await prisma.siteContaminant.createMany({
    data: [
      { siteId: near.id, contaminantId: tce.id, media: 'Groundwater' },
      { siteId: near.id, contaminantId: lead.id, media: 'Soil' }
    ]
  });
}

if (process.argv[1]?.includes('seed-fixture')) {
  const prisma = new PrismaClient();
  seedFixture(prisma)
    .then(() => console.log('fixture seeded'))
    .finally(() => prisma.$disconnect());
}
```

- [ ] **Step 4: Write `playwright.config.ts`**

The fixture database lives in its own file so running E2E never destroys the real ingested data.

```ts
import { defineConfig } from '@playwright/test';

const DATABASE_URL = 'file:./e2e.db';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command:
      'pnpm exec prisma migrate deploy && pnpm exec tsx tests/seed-fixture.ts && pnpm build && pnpm preview --port 4173',
    port: 4173,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { DATABASE_URL }
  }
});
```

Add `prisma/e2e.db` to `.gitignore`.

- [ ] **Step 5: Write the E2E spec**

```ts
// tests/e2e/search.spec.ts
import { expect, test } from '@playwright/test';

test.describe('exposure tracking map', () => {
  test('loads the map and pin data', async ({ page }) => {
    const sites = page.waitForResponse('**/api/sites');
    await page.goto('/');
    const body = await (await sites).json();
    expect(body.features.length).toBe(4);
    await expect(page.getByTestId('map')).toBeVisible();
    await expect(page.getByText('Enter an address')).toBeVisible();
  });

  test('searches an address and lists sites nearest first', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Street address, city, and state').fill(
      '1600 Pennsylvania Avenue NW, Washington, DC 20500'
    );
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText(/sites? within 25 miles/)).toBeVisible({ timeout: 20_000 });

    const rows = page.getByTestId('result-row');
    await expect(rows.first()).toContainText('FIXTURE NEAR SITE');

    // Distances must ascend.
    const texts = await rows.allInnerTexts();
    const distances = texts.map((t) => Number(t.match(/([\d.]+) mi/)![1]));
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(distances[0]).toBeLessThan(5);
  });

  test('opens a dialog with grouped contaminants and measures', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Street address, city, and state').fill(
      '1600 Pennsylvania Avenue NW, Washington, DC 20500'
    );
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByTestId('result-row').first().click();

    const dialog = page.getByTestId('site-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'FIXTURE NEAR SITE' })).toBeVisible();
    await expect(dialog.getByTestId('contaminants')).toContainText('Groundwater');
    await expect(dialog.getByTestId('contaminants')).toContainText('TRICHLOROETHENE');
    await expect(dialog.getByTestId('contaminants')).toContainText('Soil');
    await expect(dialog).toContainText('Human exposure under control');
    await expect(dialog).toContainText('mi away');

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('reports the empty-radius case honestly with nearest sites', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Street address, city, and state').fill('Kaktovik, AK 99747');
    await page.getByLabel('Search radius in miles').selectOption('5');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText(/Nothing within 5 miles/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('result-row')).toHaveCount(3);
  });

  test('shows a clear message for an unmatchable address', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Street address, city, and state').fill('zzzz not a real address zzzz');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText(/couldn't find that address/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('result-row')).toHaveCount(0);
  });

  test('results list rows are keyboard reachable', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Street address, city, and state').fill(
      '1600 Pennsylvania Avenue NW, Washington, DC 20500'
    );
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByTestId('result-row').first()).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('result-row').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('site-dialog')).toBeVisible();
  });
});
```

These tests hit the live Census geocoder, which is why the timeouts are generous. Only the site data is fixtured.

- [ ] **Step 6: Run the E2E suite**

Run: `pnpm exec playwright install chromium` (once), then `pnpm test:e2e`
Expected: 6 tests PASS.

Fix any failures before continuing. If the Kaktovik test finds sites within 5 miles, the fixture changed — pick a more remote address.

- [ ] **Step 7: Write the live canary test**

```ts
// src/lib/server/live.canary.test.ts
import { describe, expect, it } from 'vitest';
import { parseMeasures } from './ingest/parseMeasures';
import { healthEnvUrlFor } from './ingest/parseMeasures';
import { geocodeWithCensus } from './geocode/census';
import { fetchSiteRows } from './ingest/sources/sites';

/**
 * Hits real upstream services to detect schema and markup drift.
 * Skipped by default and never run in CI. Run deliberately:
 *   pnpm vitest run src/lib/server/live.canary.test.ts -t canary
 */
describe.skip('canary', () => {
  it('Envirofacts still returns 1840 NPL sites with coordinates', async () => {
    process.env.ETM_CACHE_DIR = '.cache-canary';
    const rows = await fetchSiteRows({ refresh: true });
    expect(rows.length).toBeGreaterThan(1700);
    const withCoords = rows.filter((r) => r.primary_latitude_decimal_val);
    expect(withCoords.length).toBe(rows.length);
    expect(rows[0]).toHaveProperty('primary_longitude_decimal_val');
  }, 120_000);

  it('the profile page still exposes a parseable measures table', async () => {
    const res = await fetch(healthEnvUrlFor('0100041'));
    const measures = parseMeasures(await res.text());
    expect(measures.humanExposureStatus).not.toBeNull();
    expect(['Yes', 'No', 'Insufficient Data', 'Status Unavailable']).toContain(
      measures.humanExposureStatus
    );
  }, 60_000);

  it('Census still returns x as longitude and y as latitude', async () => {
    const r = await geocodeWithCensus('1600 Pennsylvania Ave NW, Washington, DC 20500');
    expect(r.latitude).toBeCloseTo(38.9, 1);
    expect(r.longitude).toBeCloseTo(-77.0, 1);
  }, 60_000);
});
```

- [ ] **Step 8: Write `README.md`**

````markdown
# Exposure Tracking Map

Maps all 1,840 Superfund sites on the EPA National Priorities List and answers
one question: given a US address, which sites are nearby, how far away are they,
and what is at them?

Distances are straight-line (great-circle) miles — contamination does not follow
roads.

## Requirements

Node 20+ and pnpm 11+. **No API keys.** Geocoding uses the free US Census
geocoder and the basemap uses OpenFreeMap; neither needs an account.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm exec prisma migrate deploy
```

## Load the data

```bash
pnpm download                      # all three sources, sequentially
pnpm download --source=sites       # 1,840 NPL sites (seconds)
pnpm download --source=contaminants # contaminants of concern (a few minutes)
pnpm download --source=measures    # performance measures (15-25 minutes)
```

Flags: `--refresh` bypasses the cache, `--dry-run` reports counts without
writing, `--limit=N` caps how many sites the measures scrape visits.

Re-running is safe and idempotent. Raw payloads are cached under `.cache/`, so
an interrupted measures pass resumes rather than restarting.

## Run

```bash
pnpm dev      # development
pnpm build && pnpm preview
```

## Test

```bash
pnpm test      # unit + integration
pnpm test:e2e  # Playwright, against a seeded fixture database
pnpm check     # svelte-check
```

## Data sources

| Data | Source |
|---|---|
| NPL sites | EPA Envirofacts `envirofacts_site`, filtered by `npl_status_code` |
| Contaminants of concern | EPA Envirofacts `envirofacts_contaminants` |
| Performance measures | Scraped from EPA site-profile pages |
| Geocoding | US Census one-line geocoder |
| Basemap | OpenFreeMap vector tiles (OpenStreetMap data) |

The Human Exposure indicator has no bulk machine-readable source, so it is
scraped one page per site. The scrape is sequential with a 400 ms delay and
caches per site. `src/lib/server/ingest/parseMeasures.ts` is the only file that
needs changing if EPA restyles the page.

## Caveats

- Contaminant and measure coverage is uneven across sites. "Not reported" means
  EPA has not published the value, not that the site is clean.
- OpenFreeMap is a free community service with no uptime SLA.
- `src/lib/server/live.canary.test.ts` is skipped by default and exists to
  detect upstream schema drift. Run it deliberately when ingestion looks wrong.
````

- [ ] **Step 9: Run everything one last time**

```bash
pnpm test
pnpm check
pnpm test:e2e
pnpm build
```

Expected: all green. Report the actual counts — do not claim success without reading the output.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add site detail dialog, E2E coverage, canary test, and README"
```

---

## Verification checklist

Run through this before calling the project done. Each line is a claim that must be backed by observed output, not assumption.

- [ ] `pnpm test` — all unit and integration tests pass
- [ ] `pnpm check` — 0 svelte-check errors
- [ ] `pnpm test:e2e` — 6 Playwright tests pass
- [ ] `pnpm build` — production build succeeds
- [ ] `SELECT COUNT(*) FROM Site` returns 1840
- [ ] `SELECT COUNT(*) FROM Site WHERE humanExposureStatus IS NOT NULL` is close to 1840
- [ ] `SELECT COUNT(DISTINCT siteId) FROM SiteContaminant` is non-zero
- [ ] Guam sites appear on the map — pan west past Hawaii, or search a Guam address
- [ ] Searching a remote Alaskan address at 5 mi shows the "nothing within" message with real nearest sites
- [ ] A nonsense address shows the 422 message, not a crash or an empty success
- [ ] Every result row is reachable by keyboard and opens the dialog with Enter
- [ ] Escape closes the dialog and returns focus to the page
