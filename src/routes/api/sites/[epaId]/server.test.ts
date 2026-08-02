import { isHttpError } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import type { SiteDetail } from '$lib/types';

// Same technique as api/search/server.test.ts and api/sites/server.test.ts:
// mock $lib/server/queries at the module boundary so this route test never
// constructs the real PrismaClient singleton or touches a database.
const siteDetail = vi.fn();
vi.mock('$lib/server/queries', () => ({ siteDetail: (...args: unknown[]) => siteDetail(...args) }));
vi.mock('$lib/server/prisma', () => ({ prisma: {} }));

const { GET } = await import('./+server');

const fixture: SiteDetail = {
  epaId: 'GA0001234567',
  semsSiteId: '0401234',
  name: 'Test Superfund Site',
  streetAddress: '123 Main St',
  supplementalAddress: null,
  city: 'Atlanta',
  county: 'Fulton',
  state: 'GA',
  zip: '30301',
  latitude: 33.7,
  longitude: -84.1,
  epaRegion: '04',
  nplStatusName: 'Final',
  nplStatusCode: 'F',
  federalFacility: false,
  humanExposureStatus: 'Under Control',
  groundwaterMigrationStatus: 'Under Control',
  constructionComplete: 'Yes',
  sitewideReadyForUse: null,
  profileUrl: 'https://cumulis.epa.gov/supercpad/CurSites/csitinfo.cfm?id=0401234',
  contaminantsByMedium: [{ medium: 'Groundwater', contaminants: ['Trichloroethylene'] }]
};

describe('GET /api/sites/[epaId]', () => {
  it('returns 404 for an unknown epaId', async () => {
    siteDetail.mockResolvedValueOnce(null);
    await expect(
      GET({ params: { epaId: 'NOPE0000000' } } as never)
    ).rejects.toSatisfy((e) => isHttpError(e, 404));
    expect(siteDetail).toHaveBeenCalledWith({}, 'NOPE0000000');
  });

  it('returns the site detail for a known epaId', async () => {
    siteDetail.mockResolvedValueOnce(fixture);
    const response = await GET({ params: { epaId: 'GA0001234567' } } as never);
    const body = (await response.json()) as SiteDetail;
    expect(body).toEqual(fixture);
    expect(siteDetail).toHaveBeenCalledWith({}, 'GA0001234567');
  });
});
