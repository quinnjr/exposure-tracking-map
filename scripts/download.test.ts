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

/** Import the module fresh so its top-level `main()` re-runs against the argv/mocks in effect. */
async function runMain(args: string[]): Promise<void> {
  process.argv = ['node', 'scripts/download.ts', ...args];
  vi.resetModules();
  await import('./download.ts');
}

const summaryLogged = () =>
  logSpy.mock.calls.some((c) => String(c[0]).includes('[download] summary'));

async function waitForSummary(): Promise<void> {
  await vi.waitFor(() => expect(summaryLogged()).toBe(true), { timeout: 5000 });
}

async function waitForExit(): Promise<void> {
  await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled(), { timeout: 5000 });
}

describe('parseArgs (exercised via CLI argv, through the module self-execution)', () => {
  it('throws on an unknown --source', async () => {
    await runMain(['--source=bogus']);
    await waitForExit();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('--source must be one of') })
    );
  });

  it.each(['sites', 'contaminants', 'measures'])('accepts a valid --source=%s', async (source) => {
    // A site must already exist for contaminants/measures to get past their
    // own "no sites" precondition — that failure is unrelated to whether
    // parseArgs accepted the flag.
    await db.prisma.site.create({
      data: {
        semsSiteId: '0100041',
        epaId: 'CTD001153923',
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

    fetchSiteRowsMock.mockResolvedValue([]);
    fetchContaminantRowsMock.mockResolvedValue([]);

    await runMain([`--source=${source}`, '--dry-run']);
    await waitForSummary();

    // If parseArgs had rejected the source, main() would never reach a
    // per-source ingest call, and the rejection error (not a summary) would
    // have been logged instead.
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('--source must be one of') })
    );
  });

  it('defaults to all three sources, no limit, not dry-run, not refresh', async () => {
    fetchSiteRowsMock.mockResolvedValue([rawSite('0100041')]);
    fetchContaminantRowsMock.mockResolvedValue([]);
    fetchMeasuresMock.mockResolvedValue(emptyMeasures);

    await runMain([]);
    await waitForSummary();

    expect(fetchSiteRowsMock).toHaveBeenCalledWith({ refresh: false });
    expect(fetchContaminantRowsMock).toHaveBeenCalledWith({ refresh: false });
    // measures only runs (and thus reaches fetchMeasures) if the "measures"
    // source was included by default alongside sites/contaminants, and if
    // dryRun defaulted to false the sites source actually wrote to the DB.
    expect(fetchMeasuresMock).toHaveBeenCalled();
    const site = await db.prisma.site.findUniqueOrThrow({ where: { semsSiteId: '0100041' } });
    expect(site.name).toBe('SITE 0100041');
  });

  it.each(['abc', '0', '-5'])('throws on --limit=%s', async (limitRaw) => {
    await runMain([`--limit=${limitRaw}`]);
    await waitForExit();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('--limit must be a positive integer')
      })
    );
  });

  it('accepts a positive integer --limit', async () => {
    fetchSiteRowsMock.mockResolvedValue([]);

    await runMain(['--source=sites', '--limit=5', '--dry-run']);
    await waitForSummary();

    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('--limit must be a positive integer')
      })
    );
  });
});

describe('main() per-source isolation', () => {
  it('runs later sources and sets a non-zero exit code when an earlier source throws', async () => {
    fetchSiteRowsMock.mockResolvedValue([rawSite('0100041')]);
    fetchContaminantRowsMock.mockRejectedValue(new Error('EPA contaminants feed exploded'));
    fetchMeasuresMock.mockResolvedValue(emptyMeasures);

    // No --source flag: all three run in order (sites, contaminants, measures).
    await runMain([]);
    await waitForSummary();

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
    const summary = logSpy.mock.calls.find((c) => String(c[0]).includes('[download] summary'))?.[0];
    expect(summary).toContain('2 succeeded (sites, measures)');
    expect(summary).toContain('1 failed (contaminants)');

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
    await waitForSummary();

    expect(fetchSiteRowsMock).toHaveBeenCalled();
    expect(await db.prisma.site.count()).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[sites] dry run — nothing written'));
  });

  it('fetches nothing at all for measures, by design', async () => {
    await db.prisma.site.create({
      data: {
        semsSiteId: '0100041',
        epaId: 'CTD001153923',
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

    await runMain(['--source=measures', '--dry-run']);
    await waitForSummary();

    expect(fetchMeasuresMock).not.toHaveBeenCalled();
    const site = await db.prisma.site.findUniqueOrThrow({ where: { semsSiteId: '0100041' } });
    expect(site.measuresFetchedAt).toBeNull();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[measures] dry run — nothing fetched or written')
    );
  });
});
