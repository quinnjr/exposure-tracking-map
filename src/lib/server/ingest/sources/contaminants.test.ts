import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTAMINANT_PAGE_SIZE, fetchContaminantRows } from './contaminants';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'etm-cont-'));
  process.env.ETM_CACHE_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.ETM_CACHE_DIR;
});

const page = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    fk_site_id: '0100041',
    media_name: 'Groundwater',
    preferred_contaminant_name: `CHEM-${i}`
  }));

describe('fetchContaminantRows', () => {
  it('pages until a short page signals the end', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      urls.push(String(url));
      // Full page, full page, then a short page.
      const body = urls.length < 3 ? page(CONTAMINANT_PAGE_SIZE) : page(12);
      return Response.json(body, { status: 200 });
    }) as unknown as typeof fetch;

    const rows = await fetchContaminantRows({ fetchImpl });

    expect(urls).toHaveLength(3);
    expect(rows).toHaveLength(CONTAMINANT_PAGE_SIZE * 2 + 12);
    expect(urls[0]).toContain(`/rows/0:${CONTAMINANT_PAGE_SIZE - 1}/`);
    expect(urls[1]).toContain(`/rows/${CONTAMINANT_PAGE_SIZE}:${CONTAMINANT_PAGE_SIZE * 2 - 1}/`);
  });

  it('stops immediately on an empty first page', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json([], { status: 200 })
    ) as unknown as typeof fetch;
    expect(await fetchContaminantRows({ fetchImpl })).toEqual([]);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('throws with the status code on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    await expect(fetchContaminantRows({ fetchImpl })).rejects.toThrow(/500/);
  });

  it('throws instead of looping forever when every page comes back full', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(page(CONTAMINANT_PAGE_SIZE), { status: 200 })
    ) as unknown as typeof fetch;

    // Lower the ceiling so the test stays fast instead of issuing MAX_PAGES requests.
    await expect(fetchContaminantRows({ fetchImpl, maxPages: 3 })).rejects.toThrow(
      /exceeded 3 pages/
    );
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });
});
