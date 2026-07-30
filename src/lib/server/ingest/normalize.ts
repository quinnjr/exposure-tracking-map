/** A row exactly as Envirofacts `envirofacts_site` returns it. */
export type RawSiteRow = {
  site_id?: string | null;
  fk_ref_region_code?: string | null;
  name?: string | null;
  epa_id?: string | null;
  street_addr_txt?: string | null;
  supplemental_addr_txt?: string | null;
  city_name?: string | null;
  fk_ref_state_code?: string | null;
  zip_code?: string | null;
  congressional_district_code?: string | null;
  county_name?: string | null;
  fips_code?: string | null;
  primary_latitude_decimal_val?: string | number | null;
  primary_longitude_decimal_val?: string | number | null;
  npl_status_code?: string | null;
  npl_status_name?: string | null;
  federal_facility_ind?: string | null;
  archived_ind?: string | null;
};

export type SiteRecord = {
  semsSiteId: string;
  epaId: string;
  name: string;
  streetAddress: string | null;
  supplementalAddress: string | null;
  city: string | null;
  county: string | null;
  state: string;
  zip: string | null;
  fipsCode: string | null;
  congressionalDistrict: string | null;
  epaRegion: string | null;
  latitude: number;
  longitude: number;
  nplStatusCode: string;
  nplStatusName: string;
  federalFacility: boolean;
  archived: boolean;
  profileUrl: string;
};

export type RejectedRow = {
  semsSiteId: string;
  reason: 'missing-identifier' | 'invalid-coordinate' | 'duplicate-identifier';
};

const PROFILE_BASE =
  'https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm?fuseaction=second.cleanup&id=';

export function profileUrlFor(semsSiteId: string): string {
  return `${PROFILE_BASE}${semsSiteId}`;
}

/**
 * Coordinate sanity check. Deliberately NOT a contiguous-US bounding box:
 * Guam NPL sites have positive longitudes (+144.9) and would be erased.
 */
export function isValidCoordinate(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lon < -180 || lon > 180) return false;
  if (lat === 0 && lon === 0) return false;
  return true;
}

/** Module-private text coercion helper; reused by later normalizers appended to this file. */
function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

const number = (v: unknown): number => {
  const s = text(v);
  return s === null ? Number.NaN : Number(s);
};

const isYes = (v: unknown): boolean => text(v)?.toUpperCase() === 'Y';

export function normalizeSites(rows: RawSiteRow[]): {
  records: SiteRecord[];
  rejected: RejectedRow[];
} {
  const records: SiteRecord[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const semsSiteId = text(row.site_id);
    const epaId = text(row.epa_id);
    const name = text(row.name);
    const state = text(row.fk_ref_state_code);

    if (!semsSiteId || !epaId || !name || !state) {
      rejected.push({ semsSiteId: semsSiteId ?? '(unknown)', reason: 'missing-identifier' });
      continue;
    }
    if (seen.has(semsSiteId)) {
      rejected.push({ semsSiteId, reason: 'duplicate-identifier' });
      continue;
    }

    const latitude = number(row.primary_latitude_decimal_val);
    const longitude = number(row.primary_longitude_decimal_val);
    if (!isValidCoordinate(latitude, longitude)) {
      rejected.push({ semsSiteId, reason: 'invalid-coordinate' });
      continue;
    }

    seen.add(semsSiteId);
    records.push({
      semsSiteId,
      epaId,
      name,
      streetAddress: text(row.street_addr_txt),
      supplementalAddress: text(row.supplemental_addr_txt),
      city: text(row.city_name),
      county: text(row.county_name),
      state,
      zip: text(row.zip_code),
      fipsCode: text(row.fips_code),
      congressionalDistrict: text(row.congressional_district_code),
      epaRegion: text(row.fk_ref_region_code),
      latitude,
      longitude,
      nplStatusCode: text(row.npl_status_code) ?? 'F',
      nplStatusName: text(row.npl_status_name) ?? 'Unknown',
      federalFacility: isYes(row.federal_facility_ind),
      archived: isYes(row.archived_ind),
      profileUrl: profileUrlFor(semsSiteId)
    });
  }

  return { records, rejected };
}
