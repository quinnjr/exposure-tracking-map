import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSiteRows, NPL_STATUS_CODES } from './sites';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'etm-sites-'));
  process.env.ETM_CACHE_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.ETM_CACHE_DIR;
});

const row = (id: string, code: string) => ({ site_id: id, epa_id: `E${id}`, npl_status_code: code });

describe('fetchSiteRows', () => {
  it('requests every NPL status code and concatenates the results', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      seen.push(u);
      const code = u.match(/npl_status_code\/([FDP])\//)![1];
      return new Response(JSON.stringify([row(`00${code}`, code)]), { status: 200 });
    }) as unknown as typeof fetch;

    const rows = await fetchSiteRows({ fetchImpl });

    expect(seen).toHaveLength(NPL_STATUS_CODES.length);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.npl_status_code).sort()).toEqual(['D', 'F', 'P']);
  });

  it('serves a second call from cache without refetching', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([row('0100041', 'F')]), { status: 200 })
    ) as unknown as typeof fetch;

    await fetchSiteRows({ fetchImpl });
    const callsAfterFirst = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await fetchSiteRows({ fetchImpl });

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsAfterFirst
    );
  });

  it('refetches when refresh is set', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([row('0100041', 'F')]), { status: 200 })
    ) as unknown as typeof fetch;

    await fetchSiteRows({ fetchImpl });
    await fetchSiteRows({ fetchImpl, refresh: true });

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      NPL_STATUS_CODES.length * 2
    );
  });

  it('throws with the status code on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchSiteRows({ fetchImpl })).rejects.toThrow(/503/);
  });
});
