import { readCache, writeCache } from '../cache';
import type { RawSiteRow } from '../normalize';

const BASE = 'https://data.epa.gov/efservice/envirofacts_site';

/** F = Currently on the Final NPL, D = Deleted, P = Proposed. */
export const NPL_STATUS_CODES = ['F', 'D', 'P'] as const;

export const USER_AGENT =
  'exposure-tracking-map/1.0 (research project; contact: quinn.josephr@gmail.com)';

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
