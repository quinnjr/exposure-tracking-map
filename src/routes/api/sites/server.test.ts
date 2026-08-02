import { describe, expect, it, vi } from 'vitest';
import type { SiteFeatureCollection } from '$lib/types';

// This route only calls sitesGeoJson(prisma) and passes the result straight
// through json(); it never touches Prisma's query-building surface itself.
// Mocking $lib/server/queries at the module boundary (same technique as
// api/search/server.test.ts) keeps this hermetic and avoids constructing the
// real PrismaClient singleton from $lib/server/prisma outside a SvelteKit
// runtime.
const sitesGeoJson = vi.fn();
vi.mock('$lib/server/queries', () => ({ sitesGeoJson: (...args: unknown[]) => sitesGeoJson(...args) }));
vi.mock('$lib/server/prisma', () => ({ prisma: {} }));

const { GET } = await import('./+server');

const fixture: SiteFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-84.1, 33.7] },
      properties: {
        epaId: 'GA0001234567',
        semsSiteId: '0401234',
        name: 'Test Superfund Site',
        city: 'Atlanta',
        state: 'GA',
        nplStatusCode: 'F',
        nplStatusName: 'Final',
        humanExposureStatus: 'Under Control'
      }
    }
  ]
};

describe('GET /api/sites', () => {
  it('sets a cache-control header of exactly "public, max-age=3600"', async () => {
    sitesGeoJson.mockResolvedValueOnce(fixture);
    const response = await GET({} as never);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('responds 200 with a JSON content-type', async () => {
    sitesGeoJson.mockResolvedValueOnce(fixture);
    const response = await GET({} as never);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  // Because $lib/server/queries is mocked at the module boundary, this file can
  // only own the route's own contract: status, headers, delegation to
  // sitesGeoJson(prisma), and that the query result is serialised through
  // unchanged. It deliberately does NOT assert the pin `properties` key set —
  // doing so here would only round-trip `fixture` through json() and would keep
  // passing if the real producer renamed a key. That shape is pinned for real,
  // against a database row, in src/lib/server/queries.test.ts
  // ("emits exactly the eight documented pin properties and no others").
  it('delegates to sitesGeoJson(prisma) and passes its result through unchanged', async () => {
    sitesGeoJson.mockResolvedValueOnce(fixture);
    const response = await GET({} as never);
    const body = (await response.json()) as SiteFeatureCollection;

    expect(sitesGeoJson).toHaveBeenCalledWith({});
    expect(body).toEqual(fixture);
  });
});
