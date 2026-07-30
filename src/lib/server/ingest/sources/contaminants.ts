import { readCache, writeCache } from '../cache';
import type { RawContaminantRow } from '../normalize';
import { USER_AGENT, type FetchOptions } from './sites';

const BASE = 'https://data.epa.gov/efservice/envirofacts_contaminants';

/** Verified working page size against the live API. */
export const CONTAMINANT_PAGE_SIZE = 5000;

// The known feed is 72,569 rows (~15 pages at CONTAMINANT_PAGE_SIZE). This
// ceiling is generous headroom for normal data growth — several times the
// current page count — while still stopping an unbounded loop if the
// upstream ever echoes full pages indefinitely (server bug, caching proxy).
export const MAX_PAGES = 50;

export type ContaminantFetchOptions = FetchOptions & {
  /** Override for MAX_PAGES; defaults to it so production behaviour is unchanged. */
  maxPages?: number;
};

/**
 * All 72,569 contaminant rows, paginated. Covers every SEMS site, not just
 * NPL ones — callers filter to the ingested site set.
 */
export async function fetchContaminantRows(
  opts: ContaminantFetchOptions = {}
): Promise<RawContaminantRow[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const cacheKey = 'contaminants';
  const maxPages = opts.maxPages ?? MAX_PAGES;

  if (!opts.refresh) {
    const cached = readCache<RawContaminantRow[]>(cacheKey);
    if (cached) return cached;
  }

  const rows: RawContaminantRow[] = [];
  let pageCount = 0;
  for (let start = 0; ; start += CONTAMINANT_PAGE_SIZE) {
    pageCount += 1;
    if (pageCount > maxPages) {
      throw new Error(
        `Envirofacts contaminants pagination exceeded ${maxPages} pages ` +
          `(${rows.length} rows fetched so far) without a short page ending it. ` +
          `This almost certainly indicates an upstream pagination bug, not genuine ` +
          `data growth — investigate before raising the ceiling.`
      );
    }

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
