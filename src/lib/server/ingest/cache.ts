import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function cacheDir(): string {
  const dir = process.env.ETM_CACHE_DIR ?? '.cache';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Collapse anything path-like so a key can never escape the cache directory. */
const safeKey = (key: string): string => key.replace(/[^a-zA-Z0-9._-]/g, '_');

export function cachePath(key: string): string {
  return join(cacheDir(), `${safeKey(key)}.json`);
}

export function writeCache(key: string, value: unknown): void {
  writeFileSync(cachePath(key), JSON.stringify(value), 'utf8');
}

/**
 * Read a cached payload, or null if absent, older than `maxAgeMs`, or corrupt.
 * Never throws — a bad cache entry must degrade to a refetch, not a crash.
 */
export function readCache<T>(key: string, maxAgeMs: number = DEFAULT_MAX_AGE_MS): T | null {
  const path = cachePath(key);
  if (!existsSync(path)) return null;
  if (Date.now() - statSync(path).mtimeMs > maxAgeMs) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    console.warn(`[cache] discarding corrupt entry: ${path}`);
    return null;
  }
}
