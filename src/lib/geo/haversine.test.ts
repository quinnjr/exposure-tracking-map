import { describe, expect, it } from 'vitest';
import { haversineMiles } from './haversine';

const WHITE_HOUSE = { latitude: 38.898699, longitude: -77.035188 };
const LINEMASTER = { latitude: 41.940561, longitude: -71.966939 };
const GUAM = { latitude: 13.439169, longitude: 144.897361 };
const ANCHORAGE = { latitude: 61.2181, longitude: -149.9003 };

describe('haversineMiles', () => {
  it('returns zero for identical points', () => {
    expect(haversineMiles(WHITE_HOUSE, WHITE_HOUSE)).toBe(0);
  });

  it('measures a known east-coast pair', () => {
    // White House to the Linemaster Switch Superfund site, ~339 mi.
    expect(haversineMiles(WHITE_HOUSE, LINEMASTER)).toBeCloseTo(339, 0);
  });

  it('is symmetric', () => {
    expect(haversineMiles(WHITE_HOUSE, LINEMASTER)).toBeCloseTo(
      haversineMiles(LINEMASTER, WHITE_HOUSE),
      6
    );
  });

  it('handles a positive-longitude territory across the antimeridian', () => {
    // Anchorage to Guam, ~4900 mi. A naive implementation that assumes
    // negative longitudes or forgets to wrap will be wildly off.
    const d = haversineMiles(ANCHORAGE, GUAM);
    expect(d).toBeGreaterThan(4500);
    expect(d).toBeLessThan(5300);
  });

  it('never returns a negative distance', () => {
    expect(haversineMiles(GUAM, ANCHORAGE)).toBeGreaterThan(0);
  });
});
