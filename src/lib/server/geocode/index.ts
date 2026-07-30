import type { PrismaClient } from '@prisma/client';
import { geocodeWithCensus, normalizeQuery, type GeocodeResult } from './census';

export { GeocodeNotFoundError, GeocoderUnavailableError, normalizeQuery } from './census';
export type { GeocodeResult } from './census';

/** Any address-to-coordinates implementation. Swap providers here. */
export type Geocoder = (address: string) => Promise<GeocodeResult>;

export type GeocodeOptions = { geocoderImpl?: Geocoder };

/**
 * Geocode an address, reading through a database-backed cache.
 *
 * Only successes are cached. A not-found is not cached because EPA's data and
 * Census's address ranges both change; an unavailable is not cached because it
 * says nothing about the address.
 */
export async function geocode(
  prisma: PrismaClient,
  address: string,
  opts: GeocodeOptions = {}
): Promise<GeocodeResult> {
  const impl = opts.geocoderImpl ?? ((a: string) => geocodeWithCensus(a));
  const normalizedQuery = normalizeQuery(address);

  const cached = await prisma.geocodeCache.findUnique({ where: { normalizedQuery } });
  if (cached) {
    return {
      latitude: cached.latitude,
      longitude: cached.longitude,
      matchedAddress: cached.matchedAddress,
      provider: cached.provider
    };
  }

  const result = await impl(address);

  await prisma.geocodeCache.upsert({
    where: { normalizedQuery },
    create: { normalizedQuery, ...result },
    update: { ...result }
  });

  return result;
}
