import { isHttpError } from '@sveltejs/kit';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Point at an isolated, throwaway SQLite file BEFORE importing the route
// module — src/lib/server/prisma.ts instantiates its singleton PrismaClient
// at import time from DATABASE_URL, and this suite must never touch the
// real dev.db (a background scrape is writing to it). Neither test below
// reaches a database query (both are rejected by the address validation
// before searchSites/geocode runs), but this keeps the import itself safe
// regardless.
process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), 'etm-search-route-')), 'test.db')}`;

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
});
