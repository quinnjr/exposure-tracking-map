import { describe, expect, it, vi } from 'vitest';
import {
  GeocodeNotFoundError,
  GeocoderUnavailableError,
  geocodeWithCensus,
  normalizeQuery
} from './census';

// Trimmed from a real response for 1600 Pennsylvania Avenue NW.
const MATCH_BODY = {
  result: {
    addressMatches: [
      {
        matchedAddress: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500',
        coordinates: { x: -77.03518753691, y: 38.89869893252 }
      }
    ]
  }
};

const respond = (body: unknown, status = 200) =>
  Response.json(body, { status });

describe('normalizeQuery', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeQuery('  1600  Pennsylvania   Ave NW ')).toBe('1600 pennsylvania ave nw');
  });

  it('is stable across casing and spacing variants', () => {
    expect(normalizeQuery('123 Main St')).toBe(normalizeQuery('123   MAIN st'));
  });
});

describe('geocodeWithCensus', () => {
  it('maps x to longitude and y to latitude, not the reverse', async () => {
    const fetchImpl = vi.fn(async () => respond(MATCH_BODY)) as unknown as typeof fetch;
    const r = await geocodeWithCensus('1600 Pennsylvania Ave NW', { fetchImpl });

    expect(r.latitude).toBeCloseTo(38.8987, 3);
    expect(r.longitude).toBeCloseTo(-77.0352, 3);
    // Latitude can never exceed 90 — a swap would put -77 in latitude.
    expect(Math.abs(r.latitude)).toBeLessThanOrEqual(90);
    expect(r.provider).toBe('census');
    expect(r.matchedAddress).toContain('PENNSYLVANIA');
  });

  it('sends the current public benchmark and requests JSON', async () => {
    let url = '';
    const fetchImpl = vi.fn(async (u: string | URL) => {
      url = String(u);
      return respond(MATCH_BODY);
    }) as unknown as typeof fetch;
    await geocodeWithCensus('anywhere', { fetchImpl });
    expect(url).toContain('onelineaddress');
    expect(url).toContain('benchmark=Public_AR_Current');
    expect(url).toContain('format=json');
    expect(url).toContain('address=anywhere');
  });

  it('throws GeocodeNotFoundError on zero matches', async () => {
    const fetchImpl = vi.fn(async () =>
      respond({ result: { addressMatches: [] } })
    ) as unknown as typeof fetch;
    await expect(geocodeWithCensus('nowhere at all', { fetchImpl })).rejects.toThrow(
      GeocodeNotFoundError
    );
  });

  it('throws GeocoderUnavailableError on a server error', async () => {
    const fetchImpl = vi.fn(async () => respond({}, 503)) as unknown as typeof fetch;
    await expect(geocodeWithCensus('x', { fetchImpl })).rejects.toThrow(GeocoderUnavailableError);
  });

  it('throws GeocoderUnavailableError on a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    }) as unknown as typeof fetch;
    await expect(geocodeWithCensus('x', { fetchImpl })).rejects.toThrow(GeocoderUnavailableError);
  });

  it('throws GeocoderUnavailableError on malformed JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    await expect(geocodeWithCensus('x', { fetchImpl })).rejects.toThrow(GeocoderUnavailableError);
  });

  it('rejects a blank address without calling the network', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(geocodeWithCensus(' '.repeat(3), { fetchImpl })).rejects.toThrow(GeocodeNotFoundError);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
