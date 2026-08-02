import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../tests/prisma-test-client';
import { siteDetail, sitesGeoJson } from './queries';

let db: TestDatabase;

beforeAll(() => {
  db = createTestDatabase();
});
afterAll(async () => {
  await db.cleanup();
});
beforeEach(async () => {
  await db.prisma.siteContaminant.deleteMany();
  await db.prisma.contaminant.deleteMany();
  await db.prisma.site.deleteMany();
});

async function seed() {
  const site = await db.prisma.site.create({
    data: {
      semsSiteId: '0100041',
      epaId: 'CTD001153923',
      name: 'LINEMASTER SWITCH CORP.',
      streetAddress: '29 PLAINE HILL ROAD',
      city: 'WOODSTOCK',
      county: 'WINDHAM',
      state: 'CT',
      latitude: 41.940561,
      longitude: -71.966939,
      nplStatusCode: 'F',
      nplStatusName: 'Currently on the Final NPL',
      humanExposureStatus: 'Yes',
      groundwaterMigrationStatus: 'Yes',
      constructionComplete: 'Yes',
      sitewideReadyForUse: 'No',
      epaRegion: '01',
      profileUrl: 'https://example.invalid/p'
    }
  });
  const tce = await db.prisma.contaminant.create({ data: { name: 'TRICHLOROETHENE' } });
  const pb = await db.prisma.contaminant.create({ data: { name: 'LEAD' } });
  await db.prisma.siteContaminant.createMany({
    data: [
      { siteId: site.id, contaminantId: tce.id, media: 'Groundwater' },
      { siteId: site.id, contaminantId: pb.id, media: 'Groundwater' },
      { siteId: site.id, contaminantId: pb.id, media: 'Soil' }
    ]
  });
  return site;
}

describe('sitesGeoJson', () => {
  it('returns an empty FeatureCollection when there are no sites', async () => {
    const fc = await sitesGeoJson(db.prisma);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toEqual([]);
  });

  it('emits GeoJSON coordinates as [longitude, latitude]', async () => {
    await seed();
    const fc = await sitesGeoJson(db.prisma);
    expect(fc.features).toHaveLength(1);
    const [lon, lat] = fc.features[0].geometry.coordinates;
    expect(lon).toBeCloseTo(-71.966939, 6);
    expect(lat).toBeCloseTo(41.940561, 6);
  });

  it('carries the properties the map needs for styling', async () => {
    await seed();
    const [feature] = (await sitesGeoJson(db.prisma)).features;
    expect(feature.properties).toMatchObject({
      epaId: 'CTD001153923',
      name: 'LINEMASTER SWITCH CORP.',
      state: 'CT',
      nplStatusCode: 'F',
      humanExposureStatus: 'Yes'
    });
  });

  // This is the one place the pin `properties` shape is pinned exhaustively.
  // It belongs here rather than in src/routes/api/sites/server.test.ts: that
  // route test mocks $lib/server/queries wholesale, so asserting the shape
  // there would only prove a hand-written fixture survives json(). Here the
  // object under assertion is produced by sitesGeoJson from a real row, so
  // renaming, adding, or dropping a key in the .map() above fails this test.
  it('emits exactly the eight documented pin properties and no others', async () => {
    await seed();
    const [feature] = (await sitesGeoJson(db.prisma)).features;
    expect(feature.properties).toEqual({
      epaId: 'CTD001153923',
      semsSiteId: '0100041',
      name: 'LINEMASTER SWITCH CORP.',
      city: 'WOODSTOCK',
      state: 'CT',
      nplStatusCode: 'F',
      nplStatusName: 'Currently on the Final NPL',
      humanExposureStatus: 'Yes'
    });
    // Property names are strings; the default lexicographic sort is correct.
    // eslint-disable-next-line unicorn/require-array-sort-compare
    expect(Object.keys(feature.properties).sort()).toEqual([
      'city',
      'epaId',
      'humanExposureStatus',
      'name',
      'nplStatusCode',
      'nplStatusName',
      'semsSiteId',
      'state'
    ]);
  });
});

describe('siteDetail', () => {
  it('returns null for an unknown epaId', async () => {
    expect(await siteDetail(db.prisma, 'NOPE')).toBeNull();
  });

  it('groups contaminants by medium, sorted and deduplicated', async () => {
    await seed();
    const detail = await siteDetail(db.prisma, 'CTD001153923');
    expect(detail?.contaminantsByMedium).toEqual([
      { medium: 'Groundwater', contaminants: ['LEAD', 'TRICHLOROETHENE'] },
      { medium: 'Soil', contaminants: ['LEAD'] }
    ]);
  });

  it('includes all four performance measures', async () => {
    await seed();
    const detail = await siteDetail(db.prisma, 'CTD001153923');
    expect(detail).toMatchObject({
      humanExposureStatus: 'Yes',
      groundwaterMigrationStatus: 'Yes',
      constructionComplete: 'Yes',
      sitewideReadyForUse: 'No'
    });
  });

  it('returns an empty medium list for a site with no contaminant data', async () => {
    await db.prisma.site.create({
      data: {
        semsSiteId: '0100460',
        epaId: 'CTD000000460',
        name: 'BARE SITE',
        state: 'CT',
        latitude: 41.5,
        longitude: -72.5,
        nplStatusCode: 'P',
        nplStatusName: 'Proposed for NPL',
        profileUrl: 'https://example.invalid/bare'
      }
    });
    const detail = await siteDetail(db.prisma, 'CTD000000460');
    expect(detail?.contaminantsByMedium).toEqual([]);
    expect(detail?.humanExposureStatus).toBeNull();
  });
});
