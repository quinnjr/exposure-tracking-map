import { describe, expect, it } from 'vitest';
import { boundingBox } from './bbox';
import { haversineMiles } from './haversine';

const MIAMI = { latitude: 25.7617, longitude: -80.1918 };
const ANCHORAGE = { latitude: 61.2181, longitude: -149.9003 };
const NEAR_ANTIMERIDIAN = { latitude: 52.0, longitude: 179.9 };

describe('boundingBox', () => {
  it('fully contains points at exactly the radius in every cardinal direction', () => {
    const box = boundingBox(MIAMI, 25);
    const degLat = (25 / 3958.7613) * (180 / Math.PI);
    const degLon = degLat / Math.cos((MIAMI.latitude * Math.PI) / 180);

    const north = { latitude: MIAMI.latitude + degLat, longitude: MIAMI.longitude };
    const south = { latitude: MIAMI.latitude - degLat, longitude: MIAMI.longitude };
    const east = { latitude: MIAMI.latitude, longitude: MIAMI.longitude + degLon };
    const west = { latitude: MIAMI.latitude, longitude: MIAMI.longitude - degLon };

    // Confirm the fixtures really are at the radius before asserting containment.
    for (const p of [north, south, east, west]) {
      expect(haversineMiles(MIAMI, p)).toBeCloseTo(25, 1);
    }

    expect(north.latitude).toBeLessThanOrEqual(box.maxLatitude);
    expect(south.latitude).toBeGreaterThanOrEqual(box.minLatitude);
    expect(east.longitude).toBeLessThanOrEqual(box.maxLongitude);
    expect(west.longitude).toBeGreaterThanOrEqual(box.minLongitude);
  });

  it('widens longitude span at high latitude', () => {
    const miamiSpan =
      boundingBox(MIAMI, 25).maxLongitude - boundingBox(MIAMI, 25).minLongitude;
    const anchorageSpan =
      boundingBox(ANCHORAGE, 25).maxLongitude - boundingBox(ANCHORAGE, 25).minLongitude;
    expect(anchorageSpan).toBeGreaterThan(miamiSpan * 1.5);
  });

  it('clamps latitude to the poles', () => {
    const box = boundingBox({ latitude: 89.5, longitude: 0 }, 200);
    expect(box.maxLatitude).toBeLessThanOrEqual(90);
    expect(box.minLatitude).toBeGreaterThanOrEqual(-90);
  });

  it('flags a box that wraps the antimeridian', () => {
    const box = boundingBox(NEAR_ANTIMERIDIAN, 100);
    expect(box.wrapsAntimeridian).toBe(true);
    expect(box.minLongitude).toBeGreaterThan(box.maxLongitude);
  });

  it('does not flag ordinary boxes', () => {
    expect(boundingBox(MIAMI, 25).wrapsAntimeridian).toBe(false);
  });

  it('degenerates safely at zero radius', () => {
    const box = boundingBox(MIAMI, 0);
    expect(box.minLatitude).toBeCloseTo(MIAMI.latitude, 6);
    expect(box.maxLatitude).toBeCloseTo(MIAMI.latitude, 6);
  });
});
