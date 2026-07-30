import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCache, writeCache } from './cache';

let dir: string;
const original = process.env.ETM_CACHE_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'etm-cache-'));
  process.env.ETM_CACHE_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (original === undefined) delete process.env.ETM_CACHE_DIR;
  else process.env.ETM_CACHE_DIR = original;
});

describe('cache', () => {
  it('returns null for a missing key', () => {
    expect(readCache('nope')).toBeNull();
  });

  it('round-trips a value', () => {
    writeCache('sites-F', [{ site_id: '0100041' }]);
    expect(readCache<{ site_id: string }[]>('sites-F')).toEqual([{ site_id: '0100041' }]);
  });

  it('treats an entry older than maxAge as absent', () => {
    writeCache('stale', { a: 1 });
    expect(readCache('stale', -1)).toBeNull();
  });

  it('sanitizes keys so they cannot escape the cache directory', () => {
    writeCache('../../escape', { a: 1 });
    expect(readCache('../../escape')).toEqual({ a: 1 });
    // The traversal was neutralized, not honoured.
    expect(readCache('escape')).toBeNull();
  });

  it('returns null rather than throwing on corrupt JSON', () => {
    writeCache('corrupt', { a: 1 });
    writeFileSync(join(dir, 'corrupt.json'), '{not json');
    expect(readCache('corrupt')).toBeNull();
  });
});
