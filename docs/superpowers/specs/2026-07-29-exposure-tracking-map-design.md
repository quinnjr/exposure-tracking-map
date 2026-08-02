# Exposure Tracking Map — Design

**Date:** 2026-07-29
**Status:** Approved (revised 2026-07-29 after live API verification)

## Purpose

A web app that maps every Superfund site on the EPA National Priorities List (NPL) across the
United States, and answers one question for a visitor: *given my address, what Superfund sites
am I near, how far away are they, and what is at them?*

"Exposure tracking" is literal — the app ingests EPA's contaminants of concern and per-site
performance measures, including the site-wide Human Exposure indicator, so a pin communicates risk
status rather than mere existence.

## Scope

**In scope**

- Downloader that ingests NPL sites, their contaminants of concern, and their performance measures
  into a local SQLite database.
- Address search returning sites within a user-selected radius, ranked by straight-line distance.
- Pannable, zoomable 2D map of the US with a pin per site and a detail dialog per pin.

**Explicitly out of scope**

User accounts, saved searches, driving directions or travel time, historical time-series of site
status, a mobile app, and non-NPL SEMS sites (53,109 assessment-only, no-further-action, and
archived records).

## Verified data sources

All endpoints below were probed live on 2026-07-29. Counts and field names are measured, not
assumed.

### 1. Sites — EPA Envirofacts `envirofacts_site`

```
https://data.epa.gov/efservice/envirofacts_site/npl_status_code/{F|D|P}/JSON
https://data.epa.gov/efservice/envirofacts_site/npl_status_code/{code}/count/JSON
```

55,588 rows total. Filtering by `npl_status_code` yields the NPL universe:

| Code | `npl_status_name` | Count |
|---|---|---|
| `F` | Currently on the Final NPL | 1,343 |
| `D` | Deleted from the Final NPL | 460 |
| `P` | Proposed for NPL | 37 |
| | **Total NPL** | **1,840** |

Each status code returns its full result set in one request; no pagination needed.

Fields returned: `site_id`, `fk_ref_region_code`, `name`, `epa_id`, `street_addr_txt`,
`supplemental_addr_txt`, `city_name`, `fk_ref_state_code`, `zip_code`,
`congressional_district_code`, `county_name`, `fips_code`, `primary_latitude_decimal_val`,
`primary_longitude_decimal_val`, `saa_agreement_site_ind`, `npl_status_code`, `npl_status_name`,
`federal_facility_ind`, `non_npl_status_code`, `non_npl_status_name`, `non_npl_status_date`,
`archived_ind`, `archived_date`.

**Coordinate coverage on NPL sites is 100%** (0 of 1,840 missing), across 53 states and
territories.

**There is no NPL listing date and no construction-completion date in this table.** An earlier
draft of this spec promised both; neither exists. Construction-complete status comes from the
performance-measures scrape (source 3) instead, as a Yes/No indicator rather than a date.

### 2. Contaminants — EPA Envirofacts `envirofacts_contaminants`

```
https://data.epa.gov/efservice/envirofacts_contaminants/rows/{start}:{end}/JSON
```

72,569 rows covering all sites, so this feed **must be paginated** — verified working at 5,000
rows per request — and filtered locally to the ingested NPL `site_id` set.

Fields: `fk_site_id` (joins `envirofacts_site.site_id`), `operable_unit_num`, `action_name`,
`type_code`, `seq`, `media_name`, `preferred_contaminant_name`.

**There is no CAS number field.** An earlier draft of this spec included a `casNumber` column;
it has been removed.

`media_name` has at least 15 distinct values — Soil, Groundwater, Sediment, Surface Water, Sludge,
Leachate, Other, Fish Tissue, Soil Gas, Buildings/Structures, Solid Waste, Liquid Waste, Landfill
Gas, Air, Free-phase NAPL — confirming that storing media as a string rather than an enum is
correct.

### 3. Performance measures — EPA site-profile page scrape

No bulk machine-readable source for the Human Exposure indicator exists. Envirofacts exposes only
the two SEMS tables above; the Superfund Human Exposure Dashboard is interactive-only; EPA's bulk
downloads omit the field; and no EPA ArcGIS feature service publishes it. Scraping the per-site
profile page is therefore the only route, and was chosen deliberately with that cost understood.

```
https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm?fuseaction=second.Healthenv&id={site_id}
```

The page contains a "Performance Measures" table with three columns: measure label, status at this
site, and an explanatory legend. Four measure labels appear on every page that has the table:

- Human Exposure Under Control
- Groundwater Migration Under Control
- Construction Complete
- Sitewide Ready for Anticipated Use

Observed status values: `Yes`, `No`, `Insufficient Data`, `Status Unavailable`, and — for
groundwater only — `Not a Groundwater Site`.

**Two parser hazards, both verified:**

1. The third column repeats the phrases "Human Exposure Under Control", "Under Control",
   "Insufficient data", and "No" as part of its legend prose. A text-level regex over the
   flattened page will produce false matches. **The parser must locate the table, then read cell
   1 of each row, ignoring cell 2 entirely.**
2. Some sites have no Performance Measures table at all — 1 of 21 sampled, a Proposed site.
   Missing measures must persist as `null`, not as an error.

A 21-site sample across all three NPL statuses parsed 20 successfully.

### 4. Geocoding — US Census one-line geocoder

```
https://geocoding.geo.census.gov/geocoder/locations/onelineaddress
  ?address={q}&benchmark=Public_AR_Current&format=json
```

Verified working with no API key. Results arrive at
`result.addressMatches[]`, each with `matchedAddress` and `coordinates`.

**`coordinates.x` is longitude and `coordinates.y` is latitude.** This inversion is the single
easiest bug to introduce in this codebase and gets a dedicated test.

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
`(latitude, longitude)` columns; haversine then runs in JS over the candidates. At 1,840 sites this
is sub-millisecond, and it keeps `proximity.ts` a pure function with no database coupling.

**Raw-response cache.** Raw payloads are written to `.cache/` so parser iteration costs no network
calls, and test fixtures fall out as a byproduct. This matters most for the scrape, where a full
pass is ~1,840 requests.

**Coordinate validation must be territory-aware.** Guam NPL sites sit at longitude **+144.9** and
latitude **13.4**. A naive contiguous-US bounding box — or any rule assuming longitude is negative
— would silently erase US territories from the map. Validation checks only that latitude is in
[-90, 90], longitude is in [-180, 180], and the pair is not exactly `(0, 0)`. Alaska, Hawaii, Guam,
Puerto Rico, and the Virgin Islands are all in scope.

## Architecture

```
scripts/download.ts              CLI entry: --refresh, --dry-run, --source, --limit
src/lib/server/ingest/
  sources/sites.ts               Envirofacts envirofacts_site fetch
  sources/contaminants.ts        Envirofacts envirofacts_contaminants paginated fetch
  sources/measures.ts            site-profile page fetch (rate-limited)
  parseMeasures.ts               profile HTML -> measure map (pure)
  normalize.ts                   raw -> typed records (pure, heavily tested)
  upsert.ts                      idempotent writes + IngestRun audit row
  cache.ts                       raw payloads -> .cache/
src/lib/server/geocode/
  index.ts                       Geocoder interface + cache wrapper
  census.ts                      US Census geocoder implementation
src/lib/server/proximity.ts      bbox prefilter -> haversine -> ranked results
src/lib/geo/haversine.ts         pure, shared client + server
src/lib/geo/bbox.ts              radius -> lat/lng bounding box (pure)
src/routes/+page.svelte          the single page
src/routes/api/sites/+server.ts            GET all pins as GeoJSON
src/routes/api/sites/[epaId]/+server.ts    GET one site with contaminants
src/routes/api/search/+server.ts           POST address + radius -> ranked results
src/lib/components/
  Map.svelte                     MapLibre wrapper; owns no business logic
  AddressSearch.svelte           input + radius select
  ResultsList.svelte             ranked results, keyboard navigable
  SiteDialog.svelte              per-site detail
  Legend.svelte                  pin colour key
```

Each unit has one purpose and a narrow interface. `haversine.ts`, `bbox.ts`, `parseMeasures.ts`,
and `normalize.ts` are pure and carry the bulk of the test weight. `Map.svelte` wraps MapLibre and
emits events; it does not fetch or rank. `proximity.ts` takes a point, a radius, and a candidate
array — it does not touch Prisma. `+page.svelte` owns search and pin-load state (it is the page
that fetches `/api/sites` and `/api/search`); `SiteDialog` is the one exception to "only the page
fetches" — it owns its own detail/loading/failed state and fetches `/api/sites/[epaId]` itself,
inside an effect keyed on the selected `epaId`. That is safe because the effect guards against a
stale response overwriting a newer selection (a `cancelled` flag set when the prop changes before
the fetch resolves), and it surfaces the failure case visibly rather than swallowing it.

## Data model

```prisma
model Site {
  id            Int     @id @default(autoincrement())
  semsSiteId    String  @unique   // envirofacts site_id, e.g. "0100041" — join + profile URL key
  epaId         String  @unique   // e.g. "CTD001153923"
  name          String
  streetAddress String?
  supplementalAddress String?
  city          String?
  county        String?
  state         String
  zip           String?
  fipsCode      String?
  congressionalDistrict String?
  epaRegion     String?
  latitude      Float
  longitude     Float
  nplStatusCode String            // F | D | P
  nplStatusName String
  federalFacility Boolean @default(false)
  archived        Boolean @default(false)

  humanExposureStatus        String?
  groundwaterMigrationStatus String?
  constructionComplete       String?
  sitewideReadyForUse        String?
  measuresFetchedAt          DateTime?

  profileUrl    String
  contaminants  SiteContaminant[]

  @@index([latitude, longitude])
  @@index([state])
}

model Contaminant {
  id    Int    @id @default(autoincrement())
  name  String @unique
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
  recordsRejected Int      @default(0)
  status          String                  // running | success | failed
  error           String?
}
```

Status fields, `media`, and `nplStatusCode` are strings rather than Prisma enums. EPA vocabularies
drift — `Status Unavailable` and `Not a Groundwater Site` were both discovered empirically, not
documented — and an unrecognised value should land in the database with a logged warning rather
than abort ingestion. `normalize.ts` passes unknown values through verbatim.

`SiteContaminant` deduplicates to distinct `(site, contaminant, media)` triples; the source's
operable-unit and decision-document detail is discarded as unnecessary for this app.

## Downloader

Invoked as `pnpm download`. Three sources run in order, each wrapped in its own `IngestRun` row:

1. **sites** — three requests (`F`, `D`, `P`) → 1,840 `Site` records.
2. **contaminants** — paginated at 5,000 rows → `Contaminant` + `SiteContaminant`, filtered to
   ingested `semsSiteId` values.
3. **measures** — one profile-page request per site, sequential with a 400 ms politeness delay
   (~2 hours for a full pass) → the four measure columns. The original estimate of 15–25 minutes
   assumed the 400 ms delay was the dominant cost; live measurement instead showed ~3.75 seconds
   per site end-to-end, since EPA's own response time dwarfs the throttle, so 1,840 sites takes
   roughly 2 hours. The 400 ms delay itself is unchanged.

Required behaviour:

- **Idempotent.** Upsert keyed on `semsSiteId`. Re-running updates in place; safe to schedule.
- **Cached.** Raw payloads written to `.cache/`. A payload is reused for 24 hours from when it was
  written (a rolling window measured from the cache file's mtime, not a calendar-day boundary)
  unless `--refresh` is passed. The measures scrape caches per site, so an interrupted pass resumes
  rather than restarts.
- **Partial failure survivable.** If contaminants or measures fail, sites still ingest and that
  `IngestRun` records `failed` with the error text. A site with no contaminant rows renders as
  "no contaminant data reported"; a site with no measures renders as "status not reported".
- **Rejections counted, never silent.** Records failing coordinate validation are skipped and
  counted in `IngestRun.recordsRejected` and the run summary. Expected count today is zero — if it
  is ever non-zero, upstream data changed.
- **Polite.** The scrape sends a descriptive `User-Agent`, runs strictly sequentially with a delay,
  and never retries more than twice per site.

Flags: `--refresh`, `--dry-run` (parse and report counts, write nothing),
`--source=sites|contaminants|measures`, `--limit=N` (cap sites scraped, for development).

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
  results: Array<{ epaId, semsSiteId, name, city, state, latitude, longitude,
                   distanceMiles, nplStatusName, humanExposureStatus }>
}
```

Radius options: 5, 10, 25 (default), 50, 100 miles.

Distinct, separately-worded failure states:

| Condition | Response |
|---|---|
| Census returns no `addressMatches` | `422`, "We couldn't find that address" |
| Geocoder unreachable or timed out | `503`, retryable, cache left untouched |
| Radius empty | `200` with `outsideRadius: true` and nearest three sites |

The empty-radius case is a legitimate and informative answer, not a failure — "nothing within 25
miles; the closest are…" is what a visitor most wants to hear. Note that the Census geocoder only
ever matches US addresses, so a separate "outside the US" state is unreachable and is not built.

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

**Map.** `GET /api/sites` returns all 1,840 sites as a single GeoJSON `FeatureCollection`, loaded
once as a MapLibre source — the whole dataset is smaller than a photograph, so there is no
per-viewport fetching. Clustering is on by default and breaks apart on zoom. Pan and zoom use
MapLibre's native handling; nothing is hand-rolled.

**Pin encoding.** Fill colour encodes `humanExposureStatus` using the verified vocabulary:

| Value | Colour | Meaning |
|---|---|---|
| `Yes` | green | human exposure under control |
| `No` | red | unsafe contamination, exposure possible |
| `Insufficient Data` | amber | EPA cannot conclude |
| `Status Unavailable` / `null` | grey | not reported |

Deleted-from-NPL sites render with a hollow stroke, so colour is never the sole channel carrying
meaning.

**Site dialog.** Clicking a pin or a results row fetches `/api/sites/[epaId]` and shows: name,
EPA ID, street address, city/county/state, NPL status, EPA region, federal-facility flag, all four
performance measures, contaminants grouped by affected medium, and a link to the site's EPA profile
page. Distance appears only when the dialog was opened from a search result.

**Accessibility.** The results list is the non-visual path to everything the map shows: rows are
keyboard navigable and open the same dialog. The dialog uses native `<dialog>` with a focus trap
and Escape-to-close. The map canvas is `aria-hidden`, with an adjacent live region announcing
result counts. A canvas map cannot be made screen-reader navigable, so the list is the real
interface rather than a fallback.

## Testing

**Unit (Vitest).**
`haversine` against known city-pair distances. `bbox` math including high-latitude Alaska and
longitudes near the antimeridian, where naive bounding-box arithmetic fails. `parseMeasures`
against captured fixtures — a normal page, a page with no measures table, and an assertion that
the legend column never leaks into a parsed value. `normalize` against captured Envirofacts
fixtures including malformed and partial rows, plus the Guam coordinate case.

**Integration (Vitest against a temporary SQLite file).**
`upsert` idempotency — run the same payload twice and assert no duplicate rows. Partial-failure
isolation — a failing measures source leaves sites intact and marks only its own `IngestRun`
failed. Geocode cache hit and miss paths with `fetch` mocked, including the x/y inversion
assertion.

**End-to-end (Playwright, one spec).**
Seed a fixture database, load the page, assert pins render, search a known address, assert the
result count and distances, open a dialog, assert contaminants render.

**Live-network canary.**
One `describe.skip`'d suite that hits the real Census, Envirofacts, and profile-page endpoints. It
exists to detect upstream schema changes and does not run in CI.

## Implementation risks

- **The measures scrape is inherently fragile.** It depends on EPA's page markup. Mitigations: the
  parser is table-structural rather than text-based, missing measures degrade to `null` rather
  than failing, results are cached per site, and the canary test detects markup drift. If EPA
  restyles the profile page, `parseMeasures.ts` is the only file that changes.
- **A full measures pass takes ~2 hours** (1,840 sites at ~3.75 s/site end-to-end; supersedes the
  original 15–25 minute estimate, which assumed the 400 ms politeness delay was the dominant cost).
  `--limit=N` keeps the development loop fast, and per-site caching makes re-runs cheap.
- **Contaminant and measure coverage is uneven** across sites. Every UI surface must render
  correctly for a site with neither.
- **OpenFreeMap is a free community service** with no uptime SLA. The tile style URL is a single
  configuration value; swapping in another keyless provider is a one-line change.
