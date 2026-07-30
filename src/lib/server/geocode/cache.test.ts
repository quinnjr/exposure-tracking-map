import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../tests/prisma-test-client';
import { GeocodeNotFoundError, GeocoderUnavailableError } from './census';
import { geocode } from './index';

let db: TestDatabase;

beforeAll(() => {
  db = createTestDatabase();
});
afterAll(async () => {
  await db.cleanup();
});
beforeEach(async () => {
  await db.prisma.geocodeCache.deleteMany();
});

const result = {
  latitude: 38.898699,
  longitude: -77.035188,
  matchedAddress: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500',
  provider: 'census'
};

describe('geocode', () => {
  it('calls the geocoder on a cache miss and stores the result', async () => {
    const impl = vi.fn(async () => result);
    const r = await geocode(db.prisma, '1600 Pennsylvania Ave NW', { geocoderImpl: impl });
    expect(r).toMatchObject(result);
    expect(await db.prisma.geocodeCache.count()).toBe(1);
  });

  it('serves a second identical call from cache', async () => {
    const impl = vi.fn(async () => result);
    await geocode(db.prisma, '1600 Pennsylvania Ave NW', { geocoderImpl: impl });
    await geocode(db.prisma, '1600 Pennsylvania Ave NW', { geocoderImpl: impl });
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('treats casing and spacing variants as the same cache entry', async () => {
    const impl = vi.fn(async () => result);
    await geocode(db.prisma, '1600 Pennsylvania Ave NW', { geocoderImpl: impl });
    await geocode(db.prisma, '  1600   PENNSYLVANIA ave nw ', { geocoderImpl: impl });
    expect(impl).toHaveBeenCalledTimes(1);
    expect(await db.prisma.geocodeCache.count()).toBe(1);
  });

  it('does not cache a not-found result', async () => {
    const impl = vi.fn(async () => {
      throw new GeocodeNotFoundError('nowhere');
    });
    await expect(geocode(db.prisma, 'nowhere', { geocoderImpl: impl })).rejects.toThrow(
      GeocodeNotFoundError
    );
    expect(await db.prisma.geocodeCache.count()).toBe(0);
  });

  it('does not cache an unavailable result, so a retry can succeed', async () => {
    let n = 0;
    const impl = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new GeocoderUnavailableError('HTTP 503');
      return result;
    });
    await expect(geocode(db.prisma, 'x', { geocoderImpl: impl })).rejects.toThrow(
      GeocoderUnavailableError
    );
    expect(await db.prisma.geocodeCache.count()).toBe(0);

    const r = await geocode(db.prisma, 'x', { geocoderImpl: impl });
    expect(r.latitude).toBeCloseTo(38.898699, 5);
    expect(await db.prisma.geocodeCache.count()).toBe(1);
  });

  it('round-trips coordinates through the cache without swapping them', async () => {
    const impl = vi.fn(async () => result);
    await geocode(db.prisma, 'x', { geocoderImpl: impl });
    const cached = await geocode(db.prisma, 'x', { geocoderImpl: impl });
    expect(cached.latitude).toBeCloseTo(38.898699, 5);
    expect(cached.longitude).toBeCloseTo(-77.035188, 5);
  });
});
