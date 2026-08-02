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
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('returns the full pin set as a GeoJSON FeatureCollection with the expected pin properties', async () => {
    sitesGeoJson.mockResolvedValueOnce(fixture);
    const response = await GET({} as never);
    const body = (await response.json()) as SiteFeatureCollection;

    expect(body.type).toBe('FeatureCollection');
    expect(body.features).toHaveLength(1);

    const [feature] = body.features;
    expect(feature.type).toBe('Feature');
    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [-84.1, 33.7] });
    expect(feature.properties).toEqual({
      epaId: 'GA0001234567',
      semsSiteId: '0401234',
      name: 'Test Superfund Site',
      city: 'Atlanta',
      state: 'GA',
      nplStatusCode: 'F',
      nplStatusName: 'Final',
      humanExposureStatus: 'Under Control'
    });
  });
});
