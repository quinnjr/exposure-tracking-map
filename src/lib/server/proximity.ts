import { haversineMiles } from '$lib/geo/haversine';
import type { LatLng } from '$lib/geo/types';
import { RADIUS_OPTIONS } from '$lib/radius';
export { DEFAULT_RADIUS_MILES, RADIUS_OPTIONS } from '$lib/radius';

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
 *
 * Filters on the RAW (unrounded) distance, not the rounded `distanceMiles`
 * used for display. Rounding first would admit candidates up to `miles +
 * 0.049` (rounding is an absolute tolerance), which is wider than the
 * relative margin `boundingBox` applies at most radii — the box could then
 * under-select relative to this filter, silently dropping real results. See
 * `src/lib/geo/bbox.ts`'s doc comment for the invariant this preserves.
 */
export function withinRadius<T extends LatLng>(
  center: LatLng,
  candidates: T[],
  miles: number
): Ranked<T>[] {
  return candidates
    .map((c) => ({ candidate: c, raw: haversineMiles(center, c) }))
    .filter((x) => x.raw <= miles)
    .sort((a, b) => a.raw - b.raw)
    .map((x) => ({ ...x.candidate, distanceMiles: Math.round(x.raw * 10) / 10 }));
}

/** The `count` closest candidates, ignoring any radius. */
export function nearest<T extends LatLng>(
  center: LatLng,
  candidates: T[],
  count: number
): Ranked<T>[] {
  return rankByDistance(center, candidates).slice(0, count);
}