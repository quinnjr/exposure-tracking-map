import { haversineMiles } from '$lib/geo/haversine';
import type { LatLng } from '$lib/geo/types';
import { DEFAULT_RADIUS_MILES, RADIUS_OPTIONS } from '$lib/radius';

export { DEFAULT_RADIUS_MILES, RADIUS_OPTIONS };

export type Ranked<T> = T & { distanceMiles: number };

export function isValidRadius(value: unknown): value is number {
  return typeof value === 'number' && (RADIUS_OPTIONS as readonly number[]).includes(value);
}

/** Attach a straight-line distance to every candidate and sort nearest first. */
export function rankByDistance<T extends LatLng>(center: LatLng, candidates: T[]): Ranked<T>[] {
  return candidates
    .map((c) => ({
      ...c,
      distanceMiles: Math.round(haversineMiles(center, c) * 10) / 10
    }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

/**
 * Exact radius filter. Applied after the bounding-box prefilter, which
 * over-selects by design.
 */
export function withinRadius<T extends LatLng>(
  center: LatLng,
  candidates: T[],
  miles: number
): Ranked<T>[] {
  return rankByDistance(center, candidates).filter((c) => c.distanceMiles <= miles);
}

/** The `count` closest candidates, ignoring any radius. */
export function nearest<T extends LatLng>(
  center: LatLng,
  candidates: T[],
  count: number
): Ranked<T>[] {
  return rankByDistance(center, candidates).slice(0, count);
}
