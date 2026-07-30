import { isHttpError } from '@sveltejs/kit';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GeocodeNotFoundError, GeocoderUnavailableError } from '$lib/server/geocode';

// Point at an isolated, throwaway SQLite file BEFORE importing the route
// module — src/lib/server/prisma.ts instantiates its singleton PrismaClient
// at import time from DATABASE_URL, and this suite must never touch the
// real dev.db (a background scrape is writing to it). Neither test below
// reaches a database query (both are rejected by the address validation
// before searchSites/geocode runs), but this keeps the import itself safe
// regardless.
process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), 'etm-search-route-')), 'test.db')}`;

// The route calls searchSites(prisma, { address, radiusMiles }) with no
// third `opts` argument, so a geocoderImpl injected from a test cannot reach
// it — there is no seam to control what the (real) geocoder does. To reach
// the 422/503 error-mapping branches we mock searchSites itself at the
// module boundary instead.
const searchSites = vi.fn();
vi.mock('$lib/server/search', () => ({ searchSites: (...args: unknown[]) => searchSites(...args) }));

const { POST } = await import('./+server');

function requestFor(body: unknown): Request {
  return new Request('http://localhost/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('POST /api/search', () => {
  it('rejects a blank address with 400', async () => {
    await expect(POST({ request: requestFor({ address: '  ' }) } as never)).rejects.toSatisfy(
      (e) => isHttpError(e, 400)
    );
  });

  it('rejects an address over the 200-character cap with 400, without reaching the geocoder', async () => {
    const tooLong = 'A'.repeat(201);
    try {
      await POST({ request: requestFor({ address: tooLong }) } as never);
      expect.unreachable('expected POST to throw');
    } catch (e) {
      expect(isHttpError(e, 400)).toBe(true);
      if (isHttpError(e, 400)) {
        expect(e.body.message).toContain('200 characters or fewer');
      }
    }
  });

  it('rejects a body that is not valid JSON with 400', async () => {
    const request = new Request('http://localhost/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json'
    });
    try {
      await POST({ request } as never);
      expect.unreachable('expected POST to throw');
    } catch (e) {
      expect(isHttpError(e, 400)).toBe(true);
      if (isHttpError(e, 400)) {
        expect(e.body.message).toBe('Request body must be JSON');
      }
    }
  });

  it('rejects an unsupported radius with 400, without reaching the geocoder', async () => {
    try {
      await POST({ request: requestFor({ address: 'x', radiusMiles: 37 }) } as never);
      expect.unreachable('expected POST to throw');
    } catch (e) {
      expect(isHttpError(e, 400)).toBe(true);
      if (isHttpError(e, 400)) {
        expect(e.body.message).toBe('Unsupported search radius');
      }
    }
    expect(searchSites).not.toHaveBeenCalled();
  });

  it('maps a GeocodeNotFoundError from searchSites to 422 with the not-found copy', async () => {
    searchSites.mockRejectedValueOnce(new GeocodeNotFoundError('x'));
    try {
      await POST({ request: requestFor({ address: 'x' }) } as never);
      expect.unreachable('expected POST to throw');
    } catch (e) {
      expect(isHttpError(e, 422)).toBe(true);
      if (isHttpError(e, 422)) {
        expect(e.body.message).toBe("We couldn't find that address. Try adding a city and state.");
      }
    }
  });

  it('maps a GeocoderUnavailableError from searchSites to 503 with the unavailable copy', async () => {
    searchSites.mockRejectedValueOnce(new GeocoderUnavailableError('boom'));
    try {
      await POST({ request: requestFor({ address: 'x' }) } as never);
      expect.unreachable('expected POST to throw');
    } catch (e) {
      expect(isHttpError(e, 503)).toBe(true);
      if (isHttpError(e, 503)) {
        expect(e.body.message).toBe('The address lookup service is unavailable. Please try again.');
      }
    }
  });

  it('rethrows an unrelated error from searchSites rather than swallowing it', async () => {
    searchSites.mockRejectedValueOnce(new Error('unexpected boom'));
    await expect(POST({ request: requestFor({ address: 'x' }) } as never)).rejects.toThrow(
      'unexpected boom'
    );
  });
});
