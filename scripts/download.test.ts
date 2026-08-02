import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../tests/prisma-test-client';
import type { RawSiteRow } from '../src/lib/server/ingest/normalize';
import type { MeasureMap } from '../src/lib/server/ingest/parseMeasures';

// `scripts/download.ts` self-executes `main()` at module load (its very last
// line is `main().catch(...)`). That means simply importing it — even just
// to reach `parseArgs` — runs the real CLI. To exercise it safely we mock
// every network-touching source module so the self-execution operates on
// fakes, and point DATABASE_URL at a scratch SQLite database (same pattern
// as upsert.test.ts) instead of the real dev.db. No live EPA request or
// production database write ever occurs. `parseArgs`, `main`, and the three
// `ingest*` functions are not exported and are NOT made so — every assertion
// below drives the module the same way the CLI itself does: via argv, and
// observes it the same way an operator would: via console output, the
// database, and process.exitCode.
const { fetchSiteRowsMock, fetchContaminantRowsMock, fetchMeasuresMock } = vi.hoisted(() => ({
  fetchSiteRowsMock: vi.fn(),
  fetchContaminantRowsMock: vi.fn(),
  fetchMeasuresMock: vi.fn()
}));

vi.mock('../src/lib/server/ingest/sources/sites', () => ({
  fetchSiteRows: fetchSiteRowsMock
}));
vi.mock('../src/lib/server/ingest/sources/contaminants', () => ({
  fetchContaminantRows: fetchContaminantRowsMock
}));
vi.mock('../src/lib/server/ingest/sources/measures', () => ({
  fetchMeasures: fetchMeasuresMock
}));

let db: TestDatabase;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
const originalArgv = process.argv;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeAll(() => {
  db = createTestDatabase();
});

afterAll(async () => {
  await db.cleanup();
});

beforeEach(() => {
  process.env.DATABASE_URL = db.url;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Never let a real process.exit tear down the test worker.
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  process.exitCode = undefined;
  fetchSiteRowsMock.mockReset();
  fetchContaminantRowsMock.mockReset();
  fetchMeasuresMock.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.argv = originalArgv;
  process.env.DATABASE_URL = originalDatabaseUrl;
  process.exitCode = undefined;
  await db.prisma.siteContaminant.deleteMany();
  await db.prisma.contaminant.deleteMany();
  await db.prisma.site.deleteMany();
  await db.prisma.ingestRun.deleteMany();
});

const rawSite = (id: string): RawSiteRow => ({
  site_id: id,
  epa_id: `E${id}`,
  name: `SITE ${id}`,
  fk_ref_state_code: 'CT',
  primary_latitude_decimal_val: 41.9,
  primary_longitude_decimal_val: -71.9,
  npl_status_code: 'F',
  npl_status_name: 'Currently on the Final NPL'
});

const emptyMeasures: MeasureMap = {
  humanExposureStatus: null,
  groundwaterMigrationStatus: null,
  constructionComplete: null,
  sitewideReadyForUse: null
};

/** Insert a site directly, for sources whose "no sites in the database" precondition must be met first. */
const seedSite = (semsSiteId = '0100041') =>
  db.prisma.site.create({
    data: {
      semsSiteId,
      epaId: `E${semsSiteId}`,
      name: 'SEED SITE',
      state: 'CT',
      latitude: 41.9,
      longitude: -71.9,
      nplStatusCode: 'F',
      nplStatusName: 'Currently on the Final NPL',
      federalFacility: false,
      archived: false,
      profileUrl: 'https://example.invalid/p'
    }
  });

/**
 * Import the module fresh so its top-level `main()` re-runs against the
 * argv/mocks in effect, and await the run to completion. `download.ts` exports
 * the self-execution promise precisely so this can await a settled run rather
 * than poll for a log line: polling returns while `main()` is still inside its
 * `finally` (prisma.$disconnect()), so `afterEach`'s restoreAllMocks() and
 * deleteMany()s would interleave with an in-flight run.
 */
async function runMain(args: string[]): Promise<void> {
  process.argv = ['node', 'scripts/download.ts', ...args];
  vi.resetModules();
  const mod = (await import('./download.ts')) as { done: Promise<void> };
  await mod.done;
}

const summaryLine = (): string =>
  String(logSpy.mock.calls.find((c) => String(c[0]).includes('[download] summary'))?.[0] ?? '');

describe('parseArgs (exercised via CLI argv, through the module self-execution)', () => {
  it('throws on an unknown --source', async () => {
    await runMain(['--source=bogus']);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('--source must be one of') })
    );
  });

  it.each([
    ['sites', () => fetchSiteRowsMock],
    ['contaminants', () => fetchContaminantRowsMock],
    ['measures', () => fetchMeasuresMock]
  ])('--source=%s runs that source and only that source', async (source, own) => {
    // A site must already exist for contaminants/measures to get past their
    // own "no sites" precondition — that failure is unrelated to whether
    // parseArgs accepted the flag.
    await seedSite();

    fetchSiteRowsMock.mockResolvedValue([]);
    fetchContaminantRowsMock.mockResolvedValue([]);
    fetchMeasuresMock.mockResolvedValue(emptyMeasures);

    // Deliberately NOT --dry-run: for measures, dry-run returns before any
    // fetch, so the run would call no source at all and the "only this one
    // ran" assertion would hold vacuously.
    await runMain([`--source=${source}`]);

    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('--source must be one of') })
    );
    // Accepting the flag is already covered by the sibling rejection test.
    // What this pins is that `sources: [source]` actually narrows the run:
    // the named source's fetcher ran and the other two never did.
    expect(own()).toHaveBeenCalled();
    for (const [name, other] of [
      ['sites', fetchSiteRowsMock],
      ['contaminants', fetchContaminantRowsMock],
      ['measures', fetchMeasuresMock]
    ] as const) {
      if (name !== source) expect(other).not.toHaveBeenCalled();
    }
    expect(summaryLine()).toContain(`1 succeeded (${source})`);
  });

  it('defaults to all three sources, no limit, not dry-run, not refresh', async () => {
    fetchSiteRowsMock.mockResolvedValue([rawSite('0100041')]);
    fetchContaminantRowsMock.mockResolvedValue([]);
    fetchMeasuresMock.mockResolvedValue(emptyMeasures);

    await runMain([]);

    expect(fetchSiteRowsMock).toHaveBeenCalledWith({ refresh: false });
    expect(fetchContaminantRowsMock).toHaveBeenCalledWith({ refresh: false });
    // measures only runs (and thus reaches fetchMeasures) if the "measures"
    // source was included by default alongside sites/contaminants, and if
    // dryRun defaulted to false the sites source actually wrote to the DB.
    expect(fetchMeasuresMock).toHaveBeenCalled();
    const site = await db.prisma.site.findUniqueOrThrow({ where: { semsSiteId: '0100041' } });
    expect(site.name).toBe('SITE 0100041');
  });

  it.each([
    'abc',
    '0',
    '-5',
    '1.5',
    'Infinity',
    '1e21',
    // The discriminating case for Number.isSafeInteger over Number.isInteger:
    // Number('9007199254740993') === 9007199254740992, an exact integer that
    // isInteger() accepts and isSafeInteger() rejects. Loosening the guard
    // back to isFinite/isInteger fails on this row and on this row alone —
    // every other row above is rejected by both predicates.
    '9007199254740993'
  ])('throws on --limit=%s', async (limitRaw) => {
    await runMain([`--limit=${limitRaw}`]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('--limit must be a positive integer')
      })
    );
  });

  it('applies a positive integer --limit to the measures scrape', async () => {
    // Five sites in the database, --limit=2: exactly two must be scraped.
    for (const id of ['0100001', '0100002', '0100003', '0100004', '0100005']) await seedSite(id);
    fetchMeasuresMock.mockResolvedValue(emptyMeasures);

    // Not --dry-run: dry-run returns before the scrape, so the limit would
    // never be applied to anything observable.
    await runMain(['--source=measures', '--limit=2']);

    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('--limit must be a positive integer')
      })
    );
    // The outcome, not just the absence of a validation error: three of the
    // five sites were left unscraped. Hard-coding `limit: null` in parseArgs
    // (or dropping the `all.slice(0, args.limit)`) scrapes all five.
    expect(fetchMeasuresMock).toHaveBeenCalledTimes(2);
    expect(await db.prisma.site.count({ where: { measuresFetchedAt: { not: null } } })).toBe(2);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[measures] scraping 2 of 5 sites')
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('— limited by --limit=2'));
  });

  it('passes --refresh through to the source fetchers', async () => {
    fetchSiteRowsMock.mockResolvedValue([rawSite('0100041')]);
    fetchContaminantRowsMock.mockResolvedValue([]);
    fetchMeasuresMock.mockResolvedValue(emptyMeasures);

    await runMain(['--refresh']);

    // Without this, a typo in `argv.includes('--refresh')` would silently keep
    // serving stale cached EPA data with the rest of the suite green.
    expect(fetchSiteRowsMock).toHaveBeenCalledWith({ refresh: true });
    expect(fetchContaminantRowsMock).toHaveBeenCalledWith({ refresh: true });
    expect(fetchMeasuresMock).toHaveBeenCalledWith('0100041', { refresh: true });
  });
});

describe('main() per-source isolation', () => {
  it('runs later sources and sets a non-zero exit code when an earlier source throws', async () => {
    fetchSiteRowsMock.mockResolvedValue([rawSite('0100041')]);
    fetchContaminantRowsMock.mockRejectedValue(new Error('EPA contaminants feed exploded'));
    fetchMeasuresMock.mockResolvedValue(emptyMeasures);

    // No --source flag: all three run in order (sites, contaminants, measures).
    await runMain([]);

    // This is the assertion that would fail if the per-source try/catch in
    // main() were removed: a thrown contaminants ingest would otherwise
    // abort the loop and `measures` (and its fetchMeasures call) would never
    // run at all.
    expect(fetchMeasuresMock).toHaveBeenCalled();
    const site = await db.prisma.site.findUniqueOrThrow({ where: { semsSiteId: '0100041' } });
    expect(site.measuresFetchedAt).not.toBeNull();

    // The contaminants failure was logged, not swallowed...
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[contaminants] failed — continuing with remaining sources:'),
      expect.any(Error)
    );
    // ...and surfaced in the summary line.
    expect(summaryLine()).toContain('2 succeeded (sites, measures)');
    expect(summaryLine()).toContain('1 failed (contaminants)');

    // ...and the run is still reported as failed overall via exitCode, not
    // via process.exit (main() lets the process end naturally so `finally`
    // can run prisma.$disconnect()).
    expect(process.exitCode).toBe(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('--dry-run', () => {
  it('fetches and normalizes sites for real but performs no writes', async () => {
    fetchSiteRowsMock.mockResolvedValue([rawSite('0100041')]);

    await runMain(['--source=sites', '--dry-run']);

    expect(fetchSiteRowsMock).toHaveBeenCalled();
    expect(await db.prisma.site.count()).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[sites] dry run — nothing written'));
  });

  it('fetches nothing at all for measures, by design', async () => {
    await seedSite();

    await runMain(['--source=measures', '--dry-run']);

    expect(fetchMeasuresMock).not.toHaveBeenCalled();
    const site = await db.prisma.site.findUniqueOrThrow({ where: { semsSiteId: '0100041' } });
    expect(site.measuresFetchedAt).toBeNull();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[measures] dry run — nothing fetched or written')
    );
  });
});

describe('measures failure threshold', () => {
  it('fails the run when more than half the sites fail to scrape', async () => {
    for (const id of ['0100001', '0100002', '0100003']) await seedSite(id);
    // fetchMeasures never throws — it resolves null on failure. Before the
    // FAILED_ABORT_FRACTION guard this run recorded status 'success' with
    // recordsUpserted 0 and exited 0, so cron saw a clean run.
    fetchMeasuresMock.mockResolvedValue(null);

    await runMain(['--source=measures']);

    const run = await db.prisma.ingestRun.findFirstOrThrow({ where: { source: 'measures' } });
    expect(run.status).toBe('failed');
    expect(run.error).toContain('3/3');
    expect(process.exitCode).toBe(1);
    expect(summaryLine()).toContain('1 failed (measures)');
  });

  it('does not fail a run whose failures stay under the threshold', async () => {
    for (const id of ['0100001', '0100002', '0100003', '0100004']) await seedSite(id);
    // 1 of 4 failed — under FAILED_ABORT_FRACTION, so the run still succeeds.
    fetchMeasuresMock.mockResolvedValueOnce(null).mockResolvedValue(emptyMeasures);

    await runMain(['--source=measures']);

    const run = await db.prisma.ingestRun.findFirstOrThrow({ where: { source: 'measures' } });
    expect(run.status).toBe('success');
    expect(run.recordsUpserted).toBe(3);
    expect(run.recordsRejected).toBe(1);
    expect(process.exitCode).toBeUndefined();
  });
});
