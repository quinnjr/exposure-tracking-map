import { haversineMiles } from '$lib/geo/haversine';
import type { LatLng } from '$lib/geo/types';

export const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
export const DEFAULT_RADIUS_MILES = 25;

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
