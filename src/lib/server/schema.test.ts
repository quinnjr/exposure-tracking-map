import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../tests/prisma-test-client';

let db: TestDatabase;
let prisma: PrismaClient;

beforeAll(() => {
  db = createTestDatabase();
  prisma = db.prisma;
});

afterAll(async () => {
  await db.cleanup();
});

describe('schema', () => {
  it('round-trips a site with a Guam coordinate', async () => {
    const site = await prisma.site.create({
      data: {
        semsSiteId: '0900001',
        epaId: 'GUD000000001',
        name: 'TEST GUAM SITE',
        state: 'GU',
        latitude: 13.439169,
        longitude: 144.897361,
        nplStatusCode: 'F',
        nplStatusName: 'Currently on the Final NPL',
        profileUrl: 'https://example.invalid/site'
      }
    });
    expect(site.longitude).toBeGreaterThan(0);
    expect(site.humanExposureStatus).toBeNull();
  });

  it('deduplicates site-contaminant-media triples', async () => {
    const site = await prisma.site.create({
      data: {
        semsSiteId: '0100041',
        epaId: 'CTD001153923',
        name: 'LINEMASTER SWITCH CORP.',
        state: 'CT',
        latitude: 41.940561,
        longitude: -71.966939,
        nplStatusCode: 'F',
        nplStatusName: 'Currently on the Final NPL',
        profileUrl: 'https://example.invalid/site2'
      }
    });
    const c = await prisma.contaminant.create({ data: { name: 'TRICHLOROETHENE' } });
    await prisma.siteContaminant.create({
      data: { siteId: site.id, contaminantId: c.id, media: 'Groundwater' }
    });
    await expect(
      prisma.siteContaminant.create({
        data: { siteId: site.id, contaminantId: c.id, media: 'Groundwater' }
      })
    ).rejects.toThrow();

    // Same contaminant in a different medium is a distinct, allowed row.
    const second = await prisma.siteContaminant.create({
      data: { siteId: site.id, contaminantId: c.id, media: 'Soil' }
    });
    expect(second.media).toBe('Soil');
  });
});
