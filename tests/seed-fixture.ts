import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

/**
 * Deterministic dataset for the E2E test. Three sites near the White House at
 * known distances, one Guam site, and one site with no contaminant or measure
 * data, so the empty states are exercised too.
 */
export async function seedFixture(prisma: PrismaClient): Promise<void> {
  await prisma.siteContaminant.deleteMany();
  await prisma.contaminant.deleteMany();
  await prisma.site.deleteMany();
  await prisma.geocodeCache.deleteMany();
  await prisma.ingestRun.deleteMany();

  const base = {
    state: 'DC',
    nplStatusCode: 'F',
    nplStatusName: 'Currently on the Final NPL',
    city: 'WASHINGTON'
  };

  const near = await prisma.site.create({
    data: {
      ...base,
      semsSiteId: '9000001',
      epaId: 'TESTNEAR0001',
      name: 'FIXTURE NEAR SITE',
      streetAddress: '100 TEST WAY',
      county: 'DISTRICT OF COLUMBIA',
      zip: '20500',
      latitude: 38.9401,
      longitude: -77.035188,
      humanExposureStatus: 'Yes',
      groundwaterMigrationStatus: 'No',
      constructionComplete: 'Yes',
      sitewideReadyForUse: 'No',
      epaRegion: '03',
      profileUrl: 'https://example.invalid/near'
    }
  });

  await prisma.site.create({
    data: {
      ...base,
      semsSiteId: '9000002',
      epaId: 'TESTMID0002',
      name: 'FIXTURE MID SITE',
      latitude: 39.0,
      longitude: -77.035188,
      humanExposureStatus: 'Insufficient Data',
      profileUrl: 'https://example.invalid/mid'
    }
  });

  await prisma.site.create({
    data: {
      ...base,
      semsSiteId: '9000003',
      epaId: 'TESTBARE0003',
      name: 'FIXTURE BARE SITE',
      nplStatusCode: 'D',
      nplStatusName: 'Deleted from the Final NPL',
      latitude: 38.95,
      longitude: -77.05,
      profileUrl: 'https://example.invalid/bare'
    }
  });

  await prisma.site.create({
    data: {
      semsSiteId: '9000004',
      epaId: 'TESTGUAM0004',
      name: 'FIXTURE GUAM SITE',
      state: 'GU',
      city: 'HAGATNA',
      latitude: 13.439169,
      longitude: 144.897361,
      nplStatusCode: 'F',
      nplStatusName: 'Currently on the Final NPL',
      humanExposureStatus: 'No',
      profileUrl: 'https://example.invalid/guam'
    }
  });

  const tce = await prisma.contaminant.create({ data: { name: 'TRICHLOROETHENE' } });
  const lead = await prisma.contaminant.create({ data: { name: 'LEAD' } });
  await prisma.siteContaminant.createMany({
    data: [
      { siteId: near.id, contaminantId: tce.id, media: 'Groundwater' },
      { siteId: near.id, contaminantId: lead.id, media: 'Soil' }
    ]
  });
}

if (process.argv[1]?.includes('seed-fixture')) {
  const url = process.env.DATABASE_URL ?? 'file:./e2e.db';
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  seedFixture(prisma)
    .then(() => console.log('fixture seeded'))
    .finally(() => prisma.$disconnect());
}
