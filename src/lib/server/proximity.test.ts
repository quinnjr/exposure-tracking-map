import { describe, expect, it } from 'vitest';
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

// Roughly 1, 7, and 70 miles out, due north.
const CLOSE = site('close', 38.9131, -77.035188);
const MID = site('mid', 39.0, -77.035188);
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
    const boundary = site('boundary', CENTER.latitude + 25 / 69.055, CENTER.longitude);
    const r = withinRadius(CENTER, [boundary], 25);
    expect(r).toHaveLength(1);
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
