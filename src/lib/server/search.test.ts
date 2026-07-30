import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { boundingBox } from '$lib/geo/bbox';
import { createTestDatabase, type TestDatabase } from '../../../tests/prisma-test-client';
import { searchSites } from './search';

let db: TestDatabase;

const WHITE_HOUSE = {
  latitude: 38.898699,
  longitude: -77.035188,
  matchedAddress: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500',
  provider: 'census'
};

const geocoderImpl = vi.fn(async () => WHITE_HOUSE);

beforeAll(() => {
  db = createTestDatabase();
});
afterAll(async () => {
  await db.cleanup();
});

beforeEach(async () => {
  await db.prisma.siteContaminant.deleteMany();
  await db.prisma.site.deleteMany();
  await db.prisma.geocodeCache.deleteMany();
  geocoderImpl.mockClear();

  // ~4 mi, ~7 mi, and ~690 mi from the White House.
  await db.prisma.site.createMany({
    data: [
      mkSite('0100001', 'NEAR SITE', 38.9601, -77.035188),
      mkSite('0100002', 'MID SITE', 39.0, -77.035188),
      mkSite('0100003', 'DISTANT SITE', 48.9, -77.035188)
    ]
  });
});

function mkSite(semsSiteId: string, name: string, latitude: number, longitude: number) {
  return {
    semsSiteId,
    epaId: `E${semsSiteId}`,
    name,
    state: 'DC',
    latitude,
    longitude,
    nplStatusCode: 'F',
    nplStatusName: 'Currently on the Final NPL',
    humanExposureStatus: 'Yes',
    profileUrl: `https://example.invalid/${semsSiteId}`
  };
}

describe('searchSites', () => {
  it('returns sites inside the radius, nearest first', async () => {
    const r = await searchSites(
      db.prisma,
      { address: '1600 Pennsylvania Ave NW', radiusMiles: 25 },
      { geocoderImpl }
    );
    expect(r.results.map((x) => x.name)).toEqual(['NEAR SITE', 'MID SITE']);
    expect(r.outsideRadius).toBe(false);
    expect(r.radiusMiles).toBe(25);
  });

  it('echoes the geocoded point and matched address', async () => {
    const r = await searchSites(db.prisma, { address: 'x', radiusMiles: 25 }, { geocoderImpl });
    expect(r.point.latitude).toBeCloseTo(38.898699, 5);
    expect(r.point.longitude).toBeCloseTo(-77.035188, 5);
    expect(r.point.matchedAddress).toContain('PENNSYLVANIA');
  });

  it('attaches an ascending distance to each result', async () => {
    const r = await searchSites(db.prisma, { address: 'x', radiusMiles: 25 }, { geocoderImpl });
    expect(r.results[0].distanceMiles).toBeLessThan(r.results[1].distanceMiles);
    expect(r.results[0].distanceMiles).toBeGreaterThan(0);
  });

  it('excludes sites outside the radius', async () => {
    const r = await searchSites(db.prisma, { address: 'x', radiusMiles: 5 }, { geocoderImpl });
    expect(r.results.map((x) => x.name)).toEqual(['NEAR SITE']);
  });

  it('falls back to the three nearest when the radius is empty', async () => {
    await db.prisma.site.deleteMany({ where: { semsSiteId: { in: ['0100001', '0100002'] } } });
    const r = await searchSites(db.prisma, { address: 'x', radiusMiles: 25 }, { geocoderImpl });
    expect(r.outsideRadius).toBe(true);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].name).toBe('DISTANT SITE');
    expect(r.results[0].distanceMiles).toBeGreaterThan(600);
  });

  it('caps the fallback at three sites', async () => {
    await db.prisma.site.deleteMany();
    await db.prisma.site.createMany({
      data: Array.from({ length: 6 }, (_, i) =>
        mkSite(`020000${i}`, `FAR ${i}`, 48 + i, -77.035188)
      )
    });
    const r = await searchSites(db.prisma, { address: 'x', radiusMiles: 25 }, { geocoderImpl });
    expect(r.outsideRadius).toBe(true);
    expect(r.results).toHaveLength(3);
  });

  it('returns an empty result set when the database has no sites at all', async () => {
    await db.prisma.site.deleteMany();
    const r = await searchSites(db.prisma, { address: 'x', radiusMiles: 25 }, { geocoderImpl });
    expect(r.results).toEqual([]);
    expect(r.outsideRadius).toBe(true);
  });

  it('defaults to a 25 mile radius when none is supplied', async () => {
    const r = await searchSites(db.prisma, { address: 'x' }, { geocoderImpl });
    expect(r.radiusMiles).toBe(25);
  });

  it('rejects a radius that is not an allowed option', async () => {
    await expect(
      searchSites(db.prisma, { address: 'x', radiusMiles: 37 }, { geocoderImpl })
    ).rejects.toThrow(/radius/i);
  });

  it('finds Guam sites from a Guam address, proving no CONUS filter exists', async () => {
    await db.prisma.site.deleteMany();
    await db.prisma.site.create({ data: mkSite('0900001', 'ORDOT LANDFILL', 13.439169, 144.897361) });
    const guam = vi.fn(async () => ({
      latitude: 13.47,
      longitude: 144.75,
      matchedAddress: 'HAGATNA, GU',
      provider: 'census'
    }));
    const r = await searchSites(
      db.prisma,
      { address: 'Hagatna, Guam', radiusMiles: 25 },
      { geocoderImpl: guam }
    );
    expect(r.outsideRadius).toBe(false);
    expect(r.results.map((x) => x.name)).toEqual(['ORDOT LANDFILL']);
  });

  it('finds sites across a bounding box that wraps the antimeridian', async () => {
    await db.prisma.site.deleteMany();
    // Real EPA site: ADAK NAVAL AIR STATION, in the Aleutians.
    await db.prisma.site.create({ data: mkSite('9100001', 'ADAK NAVAL AIR STATION', 51.88, -176.6525) });

    // A search point far enough west that the 100-mile box crosses -180.
    const aleutian = vi.fn(async () => ({
      latitude: 51.88,
      longitude: -178.5,
      matchedAddress: 'ADAK, AK',
      provider: 'census'
    }));

    // Prove the premise: this box really does wrap, otherwise the test is vacuous.
    const box = boundingBox({ latitude: 51.88, longitude: -178.5 }, 100);
    expect(box.wrapsAntimeridian).toBe(true);
    expect(box.minLongitude).toBeGreaterThan(box.maxLongitude);

    const r = await searchSites(db.prisma, { address: 'Adak, AK', radiusMiles: 100 }, { geocoderImpl: aleutian });
    expect(r.outsideRadius).toBe(false);
    expect(r.results.map((x) => x.name)).toEqual(['ADAK NAVAL AIR STATION']);
    expect(r.results[0].distanceMiles).toBeCloseTo(78.8, 0);
  });
});
