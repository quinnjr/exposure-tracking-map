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
