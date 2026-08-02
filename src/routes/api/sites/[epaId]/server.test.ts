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
  // The 404 message is an API-wire contract, not user-visible copy:
  // src/lib/components/SiteDialog.svelte fetches this route and, on a
  // non-ok response, discards the body entirely (it rejects with just the
  // status string) and renders its own fixed "Could not load details for this
  // site." text. So the string below is pinned for API consumers, not because
  // any UI displays it — changing the UI copy does not require changing this.
  it('returns 404 with the "Site not found" body for an unknown epaId', async () => {
    siteDetail.mockResolvedValueOnce(null);
    try {
      await GET({ params: { epaId: 'NOPE0000000' } } as never);
      expect.unreachable('expected GET to throw');
    } catch (error) {
      expect(isHttpError(error, 404)).toBe(true);
      if (isHttpError(error, 404)) {
        expect(error.body.message).toBe('Site not found');
      }
    }
    expect(siteDetail).toHaveBeenCalledWith({}, 'NOPE0000000');
  });

  it('returns the site detail for a known epaId', async () => {
    siteDetail.mockResolvedValueOnce(fixture);
    const response = await GET({ params: { epaId: 'GA0001234567' } } as never);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    const body = (await response.json()) as SiteDetail;
    expect(body).toEqual(fixture);
    expect(siteDetail).toHaveBeenCalledWith({}, 'GA0001234567');
  });
});
