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

/** cumulis.epa.gov is the expected host; construct responses that carry it explicitly. */
const okOnHost = () => {
  const res = new Response(PAGE, { status: 200 });
  Object.defineProperty(res, 'url', {
    value: 'https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm?fuseaction=second.Healthenv&id=0100041'
  });
  return res;
};

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

  it('treats a cross-host redirect as a fetch failure, not an all-null result, and does not cache it', async () => {
    const fetchImpl = vi.fn(async () => {
      const res = new Response('<html>unrelated drupal page</html>', { status: 200 });
      Object.defineProperty(res, 'url', { value: 'https://www.epa.gov/ge-housatonic?fuseaction=x' });
      return res;
    }) as unknown as typeof fetch;
    const m = await fetchMeasures('0100460', { fetchImpl, delayMs: 0 });
    expect(m).toBeNull();
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);

    // Nothing was cached: a subsequent call with a working fetchImpl must hit the network again.
    const fetchImpl2 = vi.fn(async () => okOnHost()) as unknown as typeof fetch;
    const m2 = await fetchMeasures('0100460', { fetchImpl: fetchImpl2, delayMs: 0 });
    expect(m2?.humanExposureStatus).toBe('Yes');
    expect((fetchImpl2 as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('does not treat an empty res.url (no redirect information) as a redirect', async () => {
    // new Response(body) has url === '' by default; must not be flagged as off-host.
    const fetchImpl = vi.fn(async () => ok()) as unknown as typeof fetch;
    const m = await fetchMeasures('0100041', { fetchImpl, delayMs: 0 });
    expect(m?.humanExposureStatus).toBe('Yes');
  });

  it('enforces the delay before every request, not just retries, across different sites', async () => {
    // 20ms rather than the real 400ms SCRAPE_DELAY_MS, so the suite stays fast.
    const DELAY = 20;
    const timestamps: number[] = [];
    const fetchImpl = vi.fn(async () => {
      timestamps.push(performance.now());
      return ok();
    }) as unknown as typeof fetch;

    await fetchMeasures('0100041', { fetchImpl, delayMs: DELAY });
    await fetchMeasures('0100094', { fetchImpl, delayMs: DELAY }); // different site: no cache hit

    expect(timestamps).toHaveLength(2);
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(DELAY - 5); // small tolerance for timer jitter
  });
});
