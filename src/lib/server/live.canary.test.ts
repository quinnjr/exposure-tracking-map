import { describe, expect, it } from 'vitest';
import { parseMeasures, healthEnvUrlFor } from './ingest/parseMeasures';
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
