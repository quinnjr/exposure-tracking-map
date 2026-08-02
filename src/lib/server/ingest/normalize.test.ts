import { describe, expect, it } from 'vitest';
import { isValidCoordinate, normalizeSites, profileUrlFor, type RawSiteRow } from './normalize';

const LINEMASTER: RawSiteRow = {
  site_id: '0100041',
  fk_ref_region_code: '01',
  name: 'LINEMASTER SWITCH CORP.',
  epa_id: 'CTD001153923',
  street_addr_txt: '29 PLAINE HILL ROAD',
  supplemental_addr_txt: null,
  city_name: 'WOODSTOCK',
  fk_ref_state_code: 'CT',
  zip_code: '06281',
  congressional_district_code: '02',
  county_name: 'WINDHAM',
  fips_code: '09015',
  primary_latitude_decimal_val: '41.940561',
  primary_longitude_decimal_val: '-71.966939',
  npl_status_code: 'F',
  npl_status_name: 'Currently on the Final NPL',
  federal_facility_ind: 'N',
  archived_ind: 'N'
};

const GUAM: RawSiteRow = {
  ...LINEMASTER,
  site_id: '0900001',
  epa_id: 'GUD980637649',
  name: 'ORDOT LANDFILL',
  fk_ref_state_code: 'GU',
  primary_latitude_decimal_val: '13.439169',
  primary_longitude_decimal_val: '144.897361',
  federal_facility_ind: 'Y'
};

describe('isValidCoordinate', () => {
  it('accepts a positive-longitude territory', () => {
    expect(isValidCoordinate(13.439169, 144.897361)).toBe(true);
  });

  it('accepts Alaska', () => {
    expect(isValidCoordinate(64.823, -147.6)).toBe(true);
  });

  it('rejects null island', () => {
    expect(isValidCoordinate(0, 0)).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(NaN, 10)).toBe(false);
  });
});

describe('profileUrlFor', () => {
  it('builds the Healthenv-sibling cleanup profile URL', () => {
    expect(profileUrlFor('0100041')).toContain('id=0100041');
    expect(profileUrlFor('0100041')).toContain('cumulis.epa.gov');
  });
});

describe('normalizeSites', () => {
  it('maps Envirofacts field names to the schema', () => {
    const { records, rejected } = normalizeSites([LINEMASTER]);
    expect(rejected).toHaveLength(0);
    expect(records[0]).toMatchObject({
      semsSiteId: '0100041',
      epaId: 'CTD001153923',
      name: 'LINEMASTER SWITCH CORP.',
      streetAddress: '29 PLAINE HILL ROAD',
      city: 'WOODSTOCK',
      county: 'WINDHAM',
      state: 'CT',
      zip: '06281',
      epaRegion: '01',
      latitude: 41.940561,
      longitude: -71.966939,
      nplStatusCode: 'F',
      federalFacility: false,
      archived: false
    });
  });

  it('preserves Guam coordinates', () => {
    const { records, rejected } = normalizeSites([GUAM]);
    expect(rejected).toHaveLength(0);
    expect(records[0].latitude).toBeCloseTo(13.439169, 6);
    expect(records[0].longitude).toBeCloseTo(144.897361, 6);
    expect(records[0].federalFacility).toBe(true);
  });

  it('rejects rows with missing coordinates and reports why', () => {
    const bad = { ...LINEMASTER, primary_latitude_decimal_val: null };
    const { records, rejected } = normalizeSites([bad]);
    expect(records).toHaveLength(0);
    expect(rejected).toEqual([{ semsSiteId: '0100041', reason: 'invalid-coordinate' }]);
  });

  it('rejects rows missing an identifier', () => {
    const bad = { ...LINEMASTER, epa_id: null };
    const { rejected } = normalizeSites([bad]);
    expect(rejected[0].reason).toBe('missing-identifier');
  });

  it('normalizes empty strings to null', () => {
    const { records } = normalizeSites([{ ...LINEMASTER, zip_code: ' '.repeat(3) }]);
    expect(records[0].zip).toBeNull();
  });

  it('rejects rows missing npl_status_code', () => {
    const bad = { ...LINEMASTER, npl_status_code: null };
    const { records, rejected } = normalizeSites([bad]);
    expect(records).toHaveLength(0);
    expect(rejected).toEqual([{ semsSiteId: '0100041', reason: 'missing-status' }]);
  });

  it('rejects rows missing npl_status_name', () => {
    const bad = { ...LINEMASTER, npl_status_name: null };
    const { records, rejected } = normalizeSites([bad]);
    expect(records).toHaveLength(0);
    expect(rejected).toEqual([{ semsSiteId: '0100041', reason: 'missing-status' }]);
  });

  it('deduplicates repeated semsSiteId, keeping the first and recording the drop', () => {
    const { records, rejected } = normalizeSites([LINEMASTER, { ...LINEMASTER, name: 'DUPLICATE' }]);
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('LINEMASTER SWITCH CORP.');
    expect(rejected).toEqual([{ semsSiteId: '0100041', reason: 'duplicate-identifier' }]);
  });
});
