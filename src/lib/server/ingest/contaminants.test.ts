import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../tests/prisma-test-client';
import { normalizeContaminants, type RawContaminantRow } from './normalize';
import { upsertContaminants, upsertSites } from './upsert';

let db: TestDatabase;

const row = (over: Partial<RawContaminantRow> = {}): RawContaminantRow => ({
  fk_site_id: '0100041',
  media_name: 'Groundwater',
  preferred_contaminant_name: '1,1,1-TRICHLOROETHANE',
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
  await upsertSites(db.prisma, [
    {
      semsSiteId: '0100041',
      epaId: 'CTD001153923',
      name: 'LINEMASTER SWITCH CORP.',
      streetAddress: null,
      supplementalAddress: null,
      city: 'WOODSTOCK',
      county: 'WINDHAM',
      state: 'CT',
      zip: null,
      fipsCode: null,
      congressionalDistrict: null,
      epaRegion: '01',
      latitude: 41.940561,
      longitude: -71.966939,
      nplStatusCode: 'F',
      nplStatusName: 'Currently on the Final NPL',
      federalFacility: false,
      archived: false,
      profileUrl: 'https://example.invalid/p'
    }
  ]);
});

describe('normalizeContaminants', () => {
  const known = new Set(['0100041']);

  it('maps source fields', () => {
    const { records, skipped } = normalizeContaminants([row()], known);
    expect(skipped).toBe(0);
    expect(records).toEqual([
      { semsSiteId: '0100041', name: '1,1,1-TRICHLOROETHANE', media: 'Groundwater' }
    ]);
  });

  it('skips rows for sites we did not ingest', () => {
    const { records, skipped } = normalizeContaminants([row({ fk_site_id: '9999999' })], known);
    expect(records).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('deduplicates repeated site-contaminant-media triples', () => {
    // The source repeats a contaminant once per decision document.
    const { records } = normalizeContaminants([row(), row(), row()], known);
    expect(records).toHaveLength(1);
  });

  it('keeps the same contaminant in different media as separate records', () => {
    const { records } = normalizeContaminants([row(), row({ media_name: 'Soil' })], known);
    expect(records).toHaveLength(2);
  });

  it('preserves unusual media values verbatim', () => {
    const { records } = normalizeContaminants([row({ media_name: 'Free-phase NAPL' })], known);
    expect(records[0].media).toBe('Free-phase NAPL');
  });

  it('defaults a missing media_name to Other without dropping the row', () => {
    const { records, skipped } = normalizeContaminants([row({ media_name: null })], known);
    expect(skipped).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0].media).toBe('Other');
  });

  it('defaults a blank media_name to Other without dropping the row', () => {
    const { records, skipped } = normalizeContaminants([row({ media_name: '   ' })], known);
    expect(skipped).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0].media).toBe('Other');
  });

  it('skips rows with no contaminant name', () => {
    const { records, skipped } = normalizeContaminants(
      [row({ preferred_contaminant_name: '  ' })],
      known
    );
    expect(records).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe('upsertContaminants', () => {
  it('creates contaminants and links them to sites', async () => {
    const { records } = normalizeContaminants([row(), row({ media_name: 'Soil' })], new Set(['0100041']));
    expect(await upsertContaminants(db.prisma, records)).toBe(2);
    expect(await db.prisma.contaminant.count()).toBe(1);
    expect(await db.prisma.siteContaminant.count()).toBe(2);
  });

  it('is idempotent', async () => {
    const { records } = normalizeContaminants([row()], new Set(['0100041']));
    await upsertContaminants(db.prisma, records);
    await upsertContaminants(db.prisma, records);
    expect(await db.prisma.siteContaminant.count()).toBe(1);
    expect(await db.prisma.contaminant.count()).toBe(1);
  });

  it('reuses one Contaminant row across sites', async () => {
    await upsertSites(db.prisma, [
      {
        semsSiteId: '0100094',
        epaId: 'CTD001186618',
        name: 'RAYMARK INDUSTRIES, INC.',
        streetAddress: null,
        supplementalAddress: null,
        city: 'STRATFORD',
        county: 'FAIRFIELD',
        state: 'CT',
        zip: null,
        fipsCode: null,
        congressionalDistrict: null,
        epaRegion: '01',
        latitude: 41.201278,
        longitude: -73.117222,
        nplStatusCode: 'F',
        nplStatusName: 'Currently on the Final NPL',
        federalFacility: false,
        archived: false,
        profileUrl: 'https://example.invalid/p2'
      }
    ]);
    const { records } = normalizeContaminants(
      [row(), row({ fk_site_id: '0100094' })],
      new Set(['0100041', '0100094'])
    );
    await upsertContaminants(db.prisma, records);
    expect(await db.prisma.contaminant.count()).toBe(1);
    expect(await db.prisma.siteContaminant.count()).toBe(2);
  });
});
