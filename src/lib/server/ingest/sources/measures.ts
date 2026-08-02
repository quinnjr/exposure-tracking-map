import { readCache, writeCache } from '../cache';
import { healthEnvUrlFor, parseMeasures, type MeasureMap } from '../parseMeasures';
import { USER_AGENT } from './sites';

export const SCRAPE_DELAY_MS = 400;
export const MAX_RETRIES = 2;

/**
 * Some Healthenv URLs 302-redirect cross-host to unrelated EPA Drupal pages
 * that ignore the query parameters entirely. Parsing one of those yields four
 * nulls that are indistinguishable in the database from a genuine "no
 * measures table" page, silently corrupting the map. Guard against it by
 * requiring the final response to stay on the expected host.
 */
const EXPECTED_HOST = 'cumulis.epa.gov';

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
 * failed (including cross-host redirects, which are treated as a fetch
 * failure rather than a legitimate all-null result), so the caller can count
 * it as an error without aborting the pass.
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
    // Baseline politeness delay before every request, escalating as backoff on retries.
    await sleep(delayMs * (attempt + 1));
    try {
      const res = await doFetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) {
        console.warn(`[measures] ${semsSiteId} attempt ${attempt + 1}: HTTP ${res.status}`);
        continue;
      }
      // An empty res.url means the runtime gave us no redirect information —
      // that must NOT be treated as a redirect, or every same-host response
      // (including every one built by `new Response(...)` in tests) would
      // trip the guard. Only a non-empty, different host counts.
      if (res.url && new URL(res.url).host !== EXPECTED_HOST) {
        console.warn(`[measures] ${semsSiteId}: redirected off-site to ${res.url} — treating as fetch failure`);
        continue;
      }
      const measures = parseMeasures(await res.text());
      writeCache(key, measures);
      return measures;
    } catch (error) {
      console.warn(
        `[measures] ${semsSiteId} attempt ${attempt + 1}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  console.warn(`[measures] ${semsSiteId}: giving up after ${MAX_RETRIES + 1} attempts`);
  return null;
}
