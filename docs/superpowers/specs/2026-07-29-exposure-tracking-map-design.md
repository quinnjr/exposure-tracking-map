# Exposure Tracking Map — Design

**Date:** 2026-07-29
**Status:** Approved

## Purpose

A web app that maps every Superfund site on the EPA National Priorities List (NPL) across the
United States, and answers one question for a visitor: *given my address, what Superfund sites
am I near, how far away are they, and what is at them?*

"Exposure tracking" is literal — the app ingests EPA's contaminants of concern and human-exposure
indicators per site, not just names and addresses, so a pin communicates risk status rather than
mere existence.

## Scope

**In scope**

- Downloader that ingests NPL sites, their contaminants of concern, and their environmental
  indicators into a local SQLite database.
- Address search returning sites within a user-selected radius, ranked by straight-line distance.
- Pannable, zoomable 2D map of the US with a pin per site and a detail dialog per pin.

**Explicitly out of scope**

User accounts, saved searches, driving directions or travel time, historical time-series of site
status, a mobile app, and non-NPL SEMS sites (assessment-only, no-further-action, archived).

## Stack

| Concern | Choice | Rationale |
|---|---|---|
| Framework | SvelteKit 2, `adapter-node` | Prisma requires a server runtime |
| UI | Svelte 5 runes (`$state`/`$derived`) | App state is local; no stores warranted |
| Styling | Tailwind v4 via `@tailwindcss/vite` | CSS-first config, no `tailwind.config.js` |
| Database | Prisma 6 + SQLite (`prisma/dev.db`) | Single-file, seedable, no server to run |
| Map | MapLibre GL JS + OpenFreeMap tiles | BSD-licensed, keyless free vector tiles, OSM-attributed |
| Geocoding | US Census one-line geocoder | Free, no API key, authoritative for US addresses |
| Distance | Local haversine (straight-line miles) | Correct metric for proximity/exposure; no metered API |
| Tests | Vitest (unit + integration), Playwright (E2E) | |
| Tooling | pnpm, ESM, TypeScript | Matches existing `package.json` |

### Decisions worth recording

**Keyless by design.** Census geocoding plus OpenFreeMap tiles means the app runs with zero
credentials and zero billing setup. No `GOOGLE_MAPS_API_KEY`, no Mapbox token. The cost is that
Census is flakier than Google on informal or partial addresses; the UI handles a not-found result
as a first-class state rather than an error.

**Straight-line, not driving, distance.** Contamination does not follow roads. Haversine is both
the cheaper and the more honest metric here.

**Haversine in JS, not SQL.** SQLite's trigonometric functions depend on a compile-time flag that
varies across Prisma's bundled engines. A bounding-box prefilter runs in SQL against the indexed
`(latitude, longitude)` columns; haversine then runs in JS over the candidates. At ~1,340 sites
this is sub-millisecond, and it keeps `proximity.ts` a pure function with no database coupling.

**Raw-response cache.** The exact shapes of the EPA Envirofacts / SEMS endpoints must be verified
against the live API during implementation; they are not assumed here. Caching raw payloads to
`.cache/` makes parser iteration free of network calls and yields test fixtures as a byproduct.

## Architecture

```
scripts/download.ts              CLI entry: --scope, --refresh, --dry-run, --source
src/lib/server/ingest/
  sources/*.ts                   one adapter per EPA feed; each returns raw JSON
  normalize.ts                   raw -> typed records (pure, heavily tested)
  upsert.ts                      idempotent writes + IngestRun audit row
  cache.ts                       raw payloads -> .cache/ so re-parsing skips re-download
src/lib/server/geocode/
  index.ts                       Geocoder interface + cache wrapper
  census.ts                      US Census geocoder implementation
src/lib/server/proximity.ts      bbox prefilter -> haversine -> ranked results
src/lib/geo/haversine.ts         pure, shared client + server
src/routes/+page.svelte          the single page
src/routes/api/sites/+server.ts            GET all pins as GeoJSON
src/routes/api/sites/[epaId]/+server.ts    GET one site with contaminants
src/routes/api/search/+server.ts           POST address + radius -> ranked results
src/lib/components/
  Map.svelte                     MapLibre wrapper; owns no business logic
  AddressSearch.svelte           input + radius select
  ResultsList.svelte             ranked results, keyboard navigable
  SiteDialog.svelte              per-site detail
  Legend.svelte                  pin colour/shape key
```

Each unit has one purpose and a narrow interface. `haversine.ts` and `normalize.ts` are pure and
carry the bulk of the test weight. `Map.svelte` wraps MapLibre and emits events; it does not fetch
or rank. `proximity.ts` takes a point, a radius, and a candidate array — it does not touch Prisma.

## Data model

```prisma
model Site {
  id            Int     @id @default(autoincrement())
  epaId         String  @unique          // e.g. "FLD004092532"
  name          String
  streetAddress String?
  city          String?
  county        String?
  state         String
  zip           String?
  latitude      Float
  longitude     Float
  nplStatus     String                   // Final | Proposed | Deleted
  listingDate   DateTime?
  constructionCompletionDate DateTime?
  epaRegion     Int?
  profileUrl    String?

  humanExposureStatus        String?     // UnderControl | NotUnderControl | InsufficientData
  groundwaterMigrationStatus String?

  contaminants  SiteContaminant[]
  @@index([latitude, longitude])
  @@index([state])
}

model Contaminant {
  id        Int     @id @default(autoincrement())
  name      String  @unique
  casNumber String?
  sites     SiteContaminant[]
}

model SiteContaminant {
  site          Site        @relation(fields: [siteId], references: [id], onDelete: Cascade)
  siteId        Int
  contaminant   Contaminant @relation(fields: [contaminantId], references: [id])
  contaminantId Int
  media         String                   // Groundwater | Soil | Air | Sediment | SurfaceWater
  @@id([siteId, contaminantId, media])
}

model GeocodeCache {
  normalizedQuery String   @id           // lowercased, whitespace-collapsed
  latitude        Float
  longitude       Float
  matchedAddress  String
  provider        String
  createdAt       DateTime @default(now())
}

model IngestRun {
  id              Int      @id @default(autoincrement())
  source          String
  startedAt       DateTime @default(now())
  finishedAt      DateTime?
  recordsUpserted Int      @default(0)
  status          String                  // running | success | failed
  error           String?
}
```

`media`, `nplStatus`, and the two status fields are strings rather than Prisma enums. EPA
vocabularies drift, and an unrecognised value should land in the database with a logged warning
rather than abort ingestion. `normalize.ts` maps known values to the canonical spellings above and
passes unknowns through verbatim.

## Downloader

Invoked as `pnpm download`. Three source adapters run sequentially, each wrapped in its own
`IngestRun` row:

1. **NPL site list** — populates core `Site` records.
2. **Contaminants of concern** — populates `Contaminant` and `SiteContaminant`.
3. **Environmental indicators** — populates `humanExposureStatus` and
   `groundwaterMigrationStatus`.

Required behaviour:

- **Idempotent.** Upsert keyed on `epaId`. Re-running updates in place; safe to schedule.
- **Cached.** Raw payloads written to `.cache/<source>-<date>.json`. A same-day cache is reused
  unless `--refresh` is passed.
- **Partial failure survivable.** If the contaminants feed fails, sites still ingest and that
  `IngestRun` records `failed` with the error text. A site with no contaminant rows renders as
  "no contaminant data reported," not as a broken page.
- **Rejections counted, never silent.** Records with missing coordinates, `0/0` coordinates, or
  coordinates outside a US bounding box (inclusive of Alaska, Hawaii, and Puerto Rico) are skipped
  and reported in the run summary.

Flags: `--refresh`, `--dry-run` (parse and report counts, write nothing),
`--source=sites|contaminants|indicators`.

## Search flow

`POST /api/search` with `{ address, radiusMiles }`:

1. Normalize the address string; look it up in `GeocodeCache`.
2. On a cache miss, call the Census one-line geocoder and cache the result.
3. Derive a latitude/longitude bounding box for the radius; `findMany` against the indexed columns.
4. Haversine each candidate, filter to the true radius, sort ascending by distance.
5. If the radius yields nothing, query the three globally nearest sites and set
   `outsideRadius: true`.

Response shape:

```ts
{
  point: { latitude: number, longitude: number, matchedAddress: string },
  radiusMiles: number,
  outsideRadius: boolean,
  results: Array<{ epaId, name, city, state, latitude, longitude,
                   distanceMiles, nplStatus, humanExposureStatus }>
}
```

Radius options: 5, 10, 25 (default), 50, 100 miles.

Distinct, separately-worded failure states:

| Condition | Response |
|---|---|
| Address not matched by geocoder | `422`, "We couldn't find that address" |
| Matched but outside the US | `422`, "This map covers United States addresses only" |
| Geocoder unreachable or timed out | `503`, retryable, cache left untouched |
| Radius empty | `200` with `outsideRadius: true` and nearest three sites |

The empty-radius case is a legitimate and informative answer, not a failure — "nothing within 25
miles; the closest are…" is what a visitor most wants to hear.

## User interface

Single route. Header holds the address input and radius selector. Below it, a results panel on the
left and the map on the right; the panel collapses beneath the map under the `md` breakpoint.
Initial load shows the whole US with every pin and no active search.

```
+----------------------------------------------------------+
| Exposure Tracking Map          [ address input ][25mi v] |
+----------------+-----------------------------------------+
| 14 sites       |                                         |
| within 25 mi   |            MapLibre canvas              |
|                |       * clustered pins, radius ring     |
| > Site A  2.3mi|         + searched address marker       |
| > Site B  6.1mi|                                         |
| > Site C  9.8mi|                              [legend]   |
+----------------+-----------------------------------------+
```

**Map.** `GET /api/sites` returns all sites as a single GeoJSON `FeatureCollection`, loaded once as
a MapLibre source — the whole dataset is smaller than a photograph, so there is no per-viewport
fetching. Clustering is on by default and breaks apart on zoom. Pan and zoom use MapLibre's native
handling; nothing is hand-rolled.

**Pin encoding.** Fill colour encodes `humanExposureStatus`: green for under control, amber for not
under control, grey for insufficient data. Marker shape and stroke encode `nplStatus` — deleted
sites render hollow — so colour is never the sole channel carrying meaning.

**Site dialog.** Clicking a pin or a results row fetches `/api/sites/[epaId]` and shows: name,
EPA site ID, street address, city/county/state, NPL status, listing and construction-completion
dates, EPA region, human-exposure and groundwater-migration indicators, contaminants grouped by
affected media, and a link to the site's EPA profile page. Distance appears only when the dialog
was opened from a search result.

**Accessibility.** The results list is the non-visual path to everything the map shows: rows are
keyboard navigable and open the same dialog. The dialog uses native `<dialog>` with a focus trap
and Escape-to-close. The map canvas is `aria-hidden`, with an adjacent live region announcing
result counts. A canvas map cannot be made screen-reader navigable, so the list is the real
interface rather than a fallback.

## Testing

**Unit (Vitest).**
`haversine` against known city-pair distances. `normalize.ts` against captured EPA fixtures,
including malformed and partial rows. `proximity.ts` bounding-box math, specifically the
high-latitude Alaska cases and longitudes near the antimeridian where naive bounding-box arithmetic
fails.

**Integration (Vitest against a temporary SQLite file).**
`upsert` idempotency — run the same payload twice and assert no duplicate rows. Partial-failure
isolation — a failing contaminants feed leaves sites intact and marks only its own `IngestRun`
failed. Geocode cache hit and miss paths with `fetch` mocked.

**End-to-end (Playwright, one spec).**
Seed a fixture database, load the page, assert pins render, search a known address, assert the
result count and distances, open a dialog, assert contaminants render.

**Live-network canary.**
One `describe.skip`'d suite that hits the real Census and EPA endpoints. It exists to detect
upstream schema changes and does not run in CI.

## Implementation risks

- **EPA endpoint shapes are unverified.** The Envirofacts/SEMS table names and field names must be
  confirmed against the live API as the first implementation step. The source-adapter boundary and
  raw cache exist to contain this uncertainty.
- **Contaminant and indicator coverage is uneven** across sites. Every UI surface must render
  correctly for a site with neither.
- **OpenFreeMap is a free community service** with no uptime SLA. If it proves unreliable, the tile
  style URL is a single configuration value; swapping in another keyless provider is a one-line
  change.
