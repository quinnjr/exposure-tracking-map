import { describe, expect, it } from 'vitest';
import { circlePolygon } from './circle';
import { haversineMiles } from './haversine';

const MIAMI = { latitude: 25.7617, longitude: -80.1918 };
const ANCHORAGE = { latitude: 61.2181, longitude: -149.9003 };
const ADAK = { latitude: 51.88, longitude: -178.5 };

describe('circlePolygon', () => {
  it('produces a closed GeoJSON polygon', () => {
    const f = circlePolygon(MIAMI, 25);
    expect(f.type).toBe('Feature');
    expect(f.geometry.type).toBe('Polygon');
    const ring = f.geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('places every vertex at the requested radius', () => {
    const ring = circlePolygon(MIAMI, 25).geometry.coordinates[0];
    for (const [lon, lat] of ring) {
      expect(haversineMiles(MIAMI, { latitude: lat, longitude: lon })).toBeCloseTo(25, 0);
    }
  });

  it('stays accurate at high latitude', () => {
    const ring = circlePolygon(ANCHORAGE, 50).geometry.coordinates[0];
    for (const [lon, lat] of ring) {
      expect(haversineMiles(ANCHORAGE, { latitude: lat, longitude: lon })).toBeCloseTo(50, 0);
    }
  });

  it('emits coordinates as [longitude, latitude]', () => {
    const [lon, lat] = circlePolygon(MIAMI, 10).geometry.coordinates[0][0];
    expect(Math.abs(lon)).toBeGreaterThan(70);
    expect(Math.abs(lat)).toBeLessThan(40);
  });

  it('honours the step count', () => {
    expect(circlePolygon(MIAMI, 10, 32).geometry.coordinates[0]).toHaveLength(33);
  });

  it('wraps longitudes into [-180, 180] near the antimeridian (Adak, AK)', () => {
    // Adak Naval Air Station sits at longitude -178.5; a 100-mile radius ring
    // crosses the antimeridian, so unwrapped destination-point longitudes
    // would otherwise fall outside valid GeoJSON range.
    const ring = circlePolygon(ADAK, 100).geometry.coordinates[0];

    for (const [lon] of ring) {
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    }

    expect(ring[0]).toEqual(ring[ring.length - 1]);

    for (const [lon, lat] of ring) {
      expect(haversineMiles(ADAK, { latitude: lat, longitude: lon })).toBeCloseTo(100, 0);
    }
  });
});
