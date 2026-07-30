import { EARTH_RADIUS_MILES } from './haversine';
import type { LatLng } from './types';

export type BBox = {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
  /** True when the box crosses ±180°, so min > max and the query needs an OR. */
  wrapsAntimeridian: boolean;
};

/**
 * Fraction of extra margin applied to the box. The box must never
 * under-select — callers apply an exact haversine check afterwards, so
 * over-selecting costs a few wasted comparisons while under-selecting
 * silently drops real search results.
 */
const SAFETY_FACTOR = 1.001;

const degreesPerMileLatitude = 180 / (Math.PI * EARTH_RADIUS_MILES);

/**
 * Smallest lat/lng box guaranteed to contain every point within `miles` of
 * `center`. Used only as a cheap indexed prefilter — callers still apply an
 * exact haversine check, so the box may over-select but must never under-select.
 */
export function boundingBox(center: LatLng, miles: number): BBox {
  const latDelta = miles * degreesPerMileLatitude * SAFETY_FACTOR;

  const minLatitude = Math.max(-90, center.latitude - latDelta);
  const maxLatitude = Math.min(90, center.latitude + latDelta);

  // A degree of longitude narrows by cos(latitude). Use the latitude of the
  // box edge nearest a pole, where degrees are widest, so the box never
  // under-selects. Clamp the cosine to avoid a division blow-up at the poles.
  const widestLatitude = Math.max(Math.abs(minLatitude), Math.abs(maxLatitude));
  const cos = Math.max(Math.cos((widestLatitude * Math.PI) / 180), 1e-6);
  const lonDelta = Math.min(180, latDelta / cos);

  const rawMin = center.longitude - lonDelta;
  const rawMax = center.longitude + lonDelta;
  const wrapsAntimeridian = rawMin < -180 || rawMax > 180;

  const wrap = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

  return {
    minLatitude,
    maxLatitude,
    minLongitude: wrapsAntimeridian ? wrap(rawMin) : rawMin,
    maxLongitude: wrapsAntimeridian ? wrap(rawMax) : rawMax,
    wrapsAntimeridian
  };
}
