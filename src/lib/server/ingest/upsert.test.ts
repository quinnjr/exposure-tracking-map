import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../tests/prisma-test-client';
import type { SiteRecord } from './normalize';
import { upsertSites, withIngestRun } from './upsert';

let db: TestDatabase;

const site = (over: Partial<SiteRecord> = {}): SiteRecord => ({
  semsSiteId: '0100041',
  epaId: 'CTD001153923',
  name: 'LINEMASTER SWITCH CORP.',
  streetAddress: '29 PLAINE HILL ROAD',
  supplementalAddress: null,
  city: 'WOODSTOCK',
  county: 'WINDHAM',
  state: 'CT',
  zip: '06281',
  fipsCode: '09015',
  congressionalDistrict: '02',
  epaRegion: '01',
  latitude: 41.940561,
  longitude: -71.966939,
  nplStatusCode: 'F',
  nplStatusName: 'Currently on the Final NPL',
  federalFacility: false,
  archived: false,
  profileUrl: 'https://example.invalid/p',
  ...over
});

beforeAll(() => {
  db = createTestDatabase();
});

afterAll(async () => {
  await db.cleanup();
});

beforeEach(async () => {
  await db.prisma.siteContaminant.deleteMany();
  await db.prisma.contaminant.deleteMany();
  await db.prisma.site.deleteMany();
  await db.prisma.ingestRun.deleteMany();
});

describe('upsertSites', () => {
  it('inserts new sites', async () => {
    expect(await upsertSites(db.prisma, [site()])).toBe(1);
    expect(await db.prisma.site.count()).toBe(1);
  });

  it('is idempotent — running twice creates no duplicates', async () => {
    await upsertSites(db.prisma, [site()]);
    await upsertSites(db.prisma, [site()]);
    expect(await db.prisma.site.count()).toBe(1);
  });

  it('updates changed fields in place', async () => {
    await upsertSites(db.prisma, [site()]);
    await upsertSites(db.prisma, [site({ name: 'RENAMED SITE' })]);
    const row = await db.prisma.site.findUniqueOrThrow({ where: { semsSiteId: '0100041' } });
    expect(row.name).toBe('RENAMED SITE');
    expect(await db.prisma.site.count()).toBe(1);
  });

  it('never clobbers scraped measures, which come from a different source', async () => {
    await upsertSites(db.prisma, [site()]);
    await db.prisma.site.update({
      where: { semsSiteId: '0100041' },
      data: { humanExposureStatus: 'Yes' }
    });
    await upsertSites(db.prisma, [site({ name: 'AGAIN' })]);
    const row = await db.prisma.site.findUniqueOrThrow({ where: { semsSiteId: '0100041' } });
    expect(row.humanExposureStatus).toBe('Yes');
  });
});

describe('withIngestRun', () => {
  it('records a successful run', async () => {
    const result = await withIngestRun(db.prisma, 'sites', async () => ({
      upserted: 7,
      rejected: 2,
      value: 'ok'
    }));
    expect(result).toBe('ok');
    const run = await db.prisma.ingestRun.findFirstOrThrow();
    expect(run).toMatchObject({
      source: 'sites',
      status: 'success',
      recordsUpserted: 7,
      recordsRejected: 2
    });
    expect(run.finishedAt).not.toBeNull();
  });

  it('records a failed run and rethrows', async () => {
    await expect(
      withIngestRun(db.prisma, 'measures', async () => {
        throw new Error('upstream exploded');
      })
    ).rejects.toThrow('upstream exploded');

    const run = await db.prisma.ingestRun.findFirstOrThrow();
    expect(run.status).toBe('failed');
    expect(run.error).toContain('upstream exploded');
    expect(run.finishedAt).not.toBeNull();
  });

  it('propagates the original error even when the audit write also fails', async () => {
    let updateCalls = 0;
    // Simulate the observed P1008 case: the failure IS the database, so the
    // catch block's own audit write throws too. The original error must
    // still win, not the audit-write error.
    const failingPrisma = {
      ...db.prisma,
      ingestRun: {
        ...db.prisma.ingestRun,
        update: async () => {
          updateCalls += 1;
          throw new Error('P1008: socket died');
        }
      }
    } as unknown as PrismaClient;

    await expect(
      withIngestRun(failingPrisma, 'measures', async () => {
        throw new Error('upstream exploded');
      })
    ).rejects.toThrow('upstream exploded');

    expect(updateCalls).toBe(1);
  });

  it('reconciles a stale running row as failed before starting a new one', async () => {
    const staleStartedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    const stale = await db.prisma.ingestRun.create({
      data: { source: 'measures', status: 'running', startedAt: staleStartedAt }
    });
    const recent = await db.prisma.ingestRun.create({
      data: { source: 'measures', status: 'running', startedAt: new Date() }
    });

    await withIngestRun(db.prisma, 'measures', async () => ({
      upserted: 1,
      rejected: 0,
      value: 'ok'
    }));

    const reconciledStale = await db.prisma.ingestRun.findUniqueOrThrow({
      where: { id: stale.id }
    });
    expect(reconciledStale.status).toBe('failed');
    expect(reconciledStale.error).toContain('abandoned');
    expect(reconciledStale.finishedAt).not.toBeNull();

    // A recent `running` row for the same source is left alone — it might
    // be a genuinely concurrent run, not an abandoned one.
    const untouchedRecent = await db.prisma.ingestRun.findUniqueOrThrow({
      where: { id: recent.id }
    });
    expect(untouchedRecent.status).toBe('running');
  });
});
