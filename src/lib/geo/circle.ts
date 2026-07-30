import { EARTH_RADIUS_MILES } from './haversine';
import type { LatLng } from './types';

export type CircleFeature = {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
};

const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;

// Mirrors the wrap() helper in bbox.ts so both files encode the antimeridian
// convention identically.
const wrapLongitude = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * A polygon approximating the circle of `radiusMiles` around `center`, for
 * drawing the search radius. Uses the destination-point formula rather than a
 * flat offset so the shape stays a true circle on the ground at any latitude.
 * Longitudes are wrapped into [-180, 180] so the ring stays valid GeoJSON
 * when the circle crosses the antimeridian.
 */
export function circlePolygon(
  center: LatLng,
  radiusMiles: number,
  steps = 64
): CircleFeature {
  const angular = radiusMiles / EARTH_RADIUS_MILES;
  const lat1 = toRad(center.latitude);
  const lon1 = toRad(center.longitude);
  const ring: [number, number][] = [];

  for (let i = 0; i <= steps; i += 1) {
    const bearing = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
      );
    ring.push([wrapLongitude(toDeg(lon2)), toDeg(lat2)]);
  }

  // Close the ring exactly, so no floating-point gap remains.
  ring[ring.length - 1] = ring[0];

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] }
  };
}
