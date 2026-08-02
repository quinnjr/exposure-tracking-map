import { describe, expect, it } from 'vitest';
import { boundingBox } from '$lib/geo/bbox';
import { EARTH_RADIUS_MILES, haversineMiles } from '$lib/geo/haversine';
import {
  DEFAULT_RADIUS_MILES,
  isValidRadius,
  nearest,
  RADIUS_OPTIONS,
  rankByDistance,
  withinRadius
} from './proximity';

const CENTER = { latitude: 38.898699, longitude: -77.035188 }; // White House

const site = (name: string, latitude: number, longitude: number) => ({
  name,
  latitude,
  longitude
});

// Physical constant, not an implementation detail: miles per degree of latitude
// on the same sphere haversineMiles uses. Deriving it here keeps the fixture at
// the TRUE boundary instead of a hardcoded approximation.
const MILES_PER_DEGREE_LAT = (Math.PI * EARTH_RADIUS_MILES) / 180; // ~69.0934

// Roughly 1, 7, and 70 miles out, due north.
const CLOSE = site('close', 38.9131, -77.035188);
const MID = site('mid', 39, -77.035188);
const FAR = site('far', 39.9, -77.035188);

describe('radius options', () => {
  it('matches the spec exactly', () => {
    expect(RADIUS_OPTIONS).toEqual([5, 10, 25, 50, 100]);
    expect(DEFAULT_RADIUS_MILES).toBe(25);
  });

  it('validates radius input', () => {
    expect(isValidRadius(25)).toBe(true);
    expect(isValidRadius(30)).toBe(false);
    expect(isValidRadius('25')).toBe(false);
    expect(isValidRadius(null)).toBe(false);
  });
});

describe('rankByDistance', () => {
  it('sorts nearest first and attaches distances', () => {
    const ranked = rankByDistance(CENTER, [FAR, CLOSE, MID]);
    expect(ranked.map((r) => r.name)).toEqual(['close', 'mid', 'far']);
    expect(ranked[0].distanceMiles).toBeLessThan(ranked[1].distanceMiles);
  });

  it('rounds distance to one decimal place', () => {
    const [first] = rankByDistance(CENTER, [CLOSE]);
    expect(first.distanceMiles).toBe(Math.round(first.distanceMiles * 10) / 10);
  });

  it('preserves the candidate fields', () => {
    const [first] = rankByDistance(CENTER, [{ ...CLOSE, epaId: 'X1' }]);
    expect(first.epaId).toBe('X1');
  });

  it('returns an empty array for no candidates', () => {
    expect(rankByDistance(CENTER, [])).toEqual([]);
  });
});

describe('withinRadius', () => {
  it('includes only candidates inside the radius', () => {
    const r = withinRadius(CENTER, [CLOSE, MID, FAR], 25);
    expect(r.map((x) => x.name)).toEqual(['close', 'mid']);
  });

  it('returns empty when nothing is in range', () => {
    expect(withinRadius(CENTER, [FAR], 5)).toEqual([]);
  });

  it('includes a candidate exactly at the boundary', () => {
    const boundary = site('boundary', CENTER.latitude + 25 / MILES_PER_DEGREE_LAT, CENTER.longitude);
    // Confirm the fixture really is at the radius before relying on it.
    expect(haversineMiles(CENTER, boundary)).toBeCloseTo(25, 3);
    expect(withinRadius(CENTER, [boundary], 25)).toHaveLength(1);
  });

  it('excludes a candidate just past the boundary', () => {
    // Far enough out that rounding to one decimal cannot pull it back to 25.0.
    const justOutside = site('just-outside', CENTER.latitude + 25.1 / MILES_PER_DEGREE_LAT, CENTER.longitude);
    expect(haversineMiles(CENTER, justOutside)).toBeGreaterThan(25);
    expect(withinRadius(CENTER, [justOutside], 25)).toHaveLength(0);
  });

  it('the box never excludes a candidate withinRadius would accept (bbox seam)', () => {
    // Real search.ts flow: boundingBox() narrows candidates, THEN
    // withinRadius() applies the exact filter. The box's doc comment
    // requires it to never under-select relative to that exact filter — if
    // it did, a real result would be silently dropped before withinRadius
    // ever sees it.
    //
    // Build a dense ring of candidates around the radius boundary, in every
    // cardinal and intercardinal direction (longitude narrows with
    // latitude, so direction matters), and confirm every candidate
    // withinRadius would accept survives the box prefilter first.
    const radius = 25;
    const box = boundingBox(CENTER, radius);

    const insideBox = (p: { latitude: number; longitude: number }): boolean =>
      p.latitude >= box.minLatitude &&
      p.latitude <= box.maxLatitude &&
      p.longitude >= box.minLongitude &&
      p.longitude <= box.maxLongitude;

    const directions = [0, 45, 90, 135, 180, 225, 270, 315]; // degrees from north
    const offsets = [-0.5, -0.1, -0.02, -0.005, 0, 0.005, 0.02, 0.049, 0.05, 0.1];

    const candidates = directions.flatMap((bearingDeg) =>
      offsets.map((offset) => {
        const distance = radius + offset;
        const bearing = (bearingDeg * Math.PI) / 180;
        const dLat = ((distance * Math.cos(bearing)) / MILES_PER_DEGREE_LAT);
        const milesPerDegreeLonHere =
          MILES_PER_DEGREE_LAT * Math.cos((CENTER.latitude * Math.PI) / 180);
        const dLon = (distance * Math.sin(bearing)) / milesPerDegreeLonHere;
        return site(
          `${bearingDeg}-${offset}`,
          CENTER.latitude + dLat,
          CENTER.longitude + dLon
        );
      })
    );

    // What withinRadius would accept if given every candidate directly
    // (no box prefilter at all) — the ground truth for "should be included".
    const acceptedDirectly = new Set(
      withinRadius(CENTER, candidates, radius).map((c) => c.name)
    );

    for (const c of candidates) {
      if (acceptedDirectly.has(c.name)) {
        expect(insideBox(c), `box must contain accepted candidate ${c.name}`).toBe(true);
      }
    }

    // And once box-filtered, withinRadius must still yield exactly the same
    // accepted set (the box only over-selects, never changes the answer).
    const boxFiltered = candidates.filter(insideBox);
    const acceptedAfterBox = new Set(
      withinRadius(CENTER, boxFiltered, radius).map((c) => c.name)
    );
    expect(acceptedAfterBox).toEqual(acceptedDirectly);
  });
});

describe('nearest', () => {
  it('returns the n closest regardless of distance', () => {
    const r = nearest(CENTER, [FAR, CLOSE, MID], 2);
    expect(r.map((x) => x.name)).toEqual(['close', 'mid']);
  });

  it('returns everything when asked for more than exists', () => {
    expect(nearest(CENTER, [CLOSE], 3)).toHaveLength(1);
  });
});
