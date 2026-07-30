# Exposure Tracking Map

Maps all 1,840 Superfund sites on the EPA National Priorities List and answers
one question: given a US address, which sites are nearby, how far away are they,
and what is at them?

Distances are straight-line (great-circle) miles, not driving distance —
contamination does not follow roads.

## No API keys

This project needs zero accounts and zero API keys, by design. Geocoding uses
the free, keyless US Census one-line geocoder, and the basemap is served by
OpenFreeMap, a free community vector-tile host that also requires no key.
Nothing here talks to a paid or account-gated service.

## Requirements

Node 20+ and pnpm 11+.

**Use pnpm, not npm.** `devEngines.packageManager` pins pnpm; npm is blocked.
Run scripts with `pnpm exec <bin>` rather than `npx`.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

`prisma generate` is required even after `migrate deploy` — under Prisma 7,
`migrate deploy` only applies migrations, it does not regenerate the client.
Skipping this step on a fresh clone fails at runtime with a missing-client
error.

## Load the data

```bash
pnpm download                       # all three sources, sequentially
pnpm download --source=sites        # 1,840 NPL sites (seconds)
pnpm download --source=contaminants # contaminants of concern (a few minutes)
pnpm download --source=measures     # performance measures (~2 hours)
```

The performance-measures scrape visits one EPA site-profile page per site with
a 400 ms politeness delay between requests. At roughly 3.75 seconds per site
end-to-end (network + parse + write), scraping all 1,840 sites takes about
**2 hours**, not minutes — there is no bulk machine-readable source for the
Human Exposure indicator, so it has to be scraped one page at a time.

Flags:

- `--refresh` bypasses the on-disk cache and re-fetches from upstream.
- `--dry-run` reports what would be fetched/written without writing anything.
- `--source=sites|contaminants|measures` runs a single source instead of all three.
- `--limit=N` caps how many sites the measures scrape visits, useful for a quick smoke test.

Re-running is safe and idempotent. Raw payloads are cached under `.cache/`, so
an interrupted measures pass resumes rather than restarting from zero.

## Run

```bash
pnpm dev      # development
pnpm build && pnpm preview
```

## Test

```bash
pnpm test      # unit + integration (vitest)
pnpm test:e2e  # Playwright, against a seeded fixture database
pnpm check     # svelte-check
```

`pnpm test:e2e` builds and previews the app against its own `e2e.db` SQLite
file, seeded fresh from `tests/seed-fixture.ts` on every run. It never touches
`dev.db`, the database used by `pnpm dev` and populated by `pnpm download`.

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

### The real data shape

As ingested from the live EPA sources, the dataset is:

- **1,840 NPL sites**: 1,343 Final, 460 Deleted, 37 Proposed.
- **690 distinct contaminants**, linked to sites through **56,552**
  site-contaminant-media rows.
- **17 distinct affected media** (Groundwater, Soil, Surface Water, Air, and
  so on) across those links.

## Caveats

- **Contaminant coverage is uneven.** Of the 1,840 sites, 1,607 have at least
  one recorded contaminant; the remaining 233 have none. "No contaminant data
  reported for this site" in the dialog means EPA has not published contaminant
  data for that site, not that the site has none.
- **Performance-measure coverage is uneven too, and grows over time.** "Not
  reported" for a measure means EPA has not published a value for it — never
  read it as "no exposure" or "under control."
- **Distances are straight-line, not driving distance.** A site "3 miles away"
  by great-circle distance may be much farther by road.
- **The Census geocoder matches street addresses, not place names.** An input
  like `"Nome, AK"` (city/state only) returns no match — the geocoder needs a
  street-level address, e.g. `"100 2nd Avenue, Glasgow, MT 59230"`. Users
  searching by city and state alone will hit the "couldn't find that address"
  message; adding a street address resolves it.
- OpenFreeMap is a free community service with no uptime SLA.
- `src/lib/server/live.canary.test.ts` is skipped by default (`describe.skip`)
  and exists to detect upstream schema/markup drift. `describe.skip` always
  skips regardless of test filters, so to run it deliberately, temporarily
  change `describe.skip` to `describe` in that file, then run
  `pnpm exec vitest run src/lib/server/live.canary.test.ts`. Revert the change
  afterward — it must never run in CI, since it depends on live EPA and Census
  endpoints.
