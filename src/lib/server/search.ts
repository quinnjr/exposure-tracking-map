import type { PrismaClient } from '@prisma/client';
import { boundingBox } from '$lib/geo/bbox';
import { geocode, type GeocodeOptions } from './geocode';
import {
  DEFAULT_RADIUS_MILES,
  isValidRadius,
  nearest,
  withinRadius
} from './proximity';

export type { SearchResult, SearchResponse } from '$lib/types';
import type { SearchResponse } from '$lib/types';

export const NEAREST_FALLBACK_COUNT = 3;

const SELECT = {
  epaId: true,
  semsSiteId: true,
  name: true,
  city: true,
  state: true,
  latitude: true,
  longitude: true,
  nplStatusName: true,
  nplStatusCode: true,
  humanExposureStatus: true
} as const;

/**
 * Geocode an address, then rank sites by straight-line distance.
 *
 * A bounding-box query narrows candidates using the (latitude, longitude)
 * index; the exact radius test happens in JS. When nothing falls inside the
 * radius we report the nearest few instead, which is the useful answer.
 */
export async function searchSites(
  prisma: PrismaClient,
  params: { address: string; radiusMiles?: number },
  opts: GeocodeOptions = {}
): Promise<SearchResponse> {
  const radiusMiles = params.radiusMiles ?? DEFAULT_RADIUS_MILES;
  if (!isValidRadius(radiusMiles)) {
    throw new Error(`Unsupported radius: ${radiusMiles}`);
  }

  const point = await geocode(prisma, params.address, opts);
  const box = boundingBox(point, radiusMiles);

  const longitudeFilter = box.wrapsAntimeridian
    ? { OR: [{ longitude: { gte: box.minLongitude } }, { longitude: { lte: box.maxLongitude } }] }
    : { longitude: { gte: box.minLongitude, lte: box.maxLongitude } };

  const candidates = await prisma.site.findMany({
    where: {
      latitude: { gte: box.minLatitude, lte: box.maxLatitude },
      ...longitudeFilter
    },
    select: SELECT
  });

  const inRadius = withinRadius(point, candidates, radiusMiles);

  if (inRadius.length > 0) {
    return {
      point: {
        latitude: point.latitude,
        longitude: point.longitude,
        matchedAddress: point.matchedAddress
      },
      radiusMiles,
      outsideRadius: false,
      results: inRadius
    };
  }

  // Nothing nearby. Scan every site for the closest few — an honest answer
  // beats an empty list, and 1,840 rows is a trivial scan.
  const all = await prisma.site.findMany({ select: SELECT });

  return {
    point: {
      latitude: point.latitude,
      longitude: point.longitude,
      matchedAddress: point.matchedAddress
    },
    radiusMiles,
    outsideRadius: true,
    results: nearest(point, all, NEAREST_FALLBACK_COUNT)
  };
}
