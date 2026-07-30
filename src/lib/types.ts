/**
 * Client-safe shared types. This module must contain ONLY type declarations
 * — no functions, no constants, no imports from `$lib/server/*` — so that
 * Svelte components can import these types without pulling in SvelteKit's
 * server-only-module guard (which errors on client code importing
 * `$lib/server/*`, even for type-only imports).
 */

export type SitePinProperties = {
  epaId: string;
  semsSiteId: string;
  name: string;
  city: string | null;
  state: string;
  nplStatusCode: string;
  nplStatusName: string;
  humanExposureStatus: string | null;
};

export type SiteFeature = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: SitePinProperties;
};

export type SiteFeatureCollection = {
  type: 'FeatureCollection';
  features: SiteFeature[];
};

export type SiteDetail = {
  epaId: string;
  semsSiteId: string;
  name: string;
  streetAddress: string | null;
  supplementalAddress: string | null;
  city: string | null;
  county: string | null;
  state: string;
  zip: string | null;
  latitude: number;
  longitude: number;
  epaRegion: string | null;
  nplStatusName: string;
  nplStatusCode: string;
  federalFacility: boolean;
  humanExposureStatus: string | null;
  groundwaterMigrationStatus: string | null;
  constructionComplete: string | null;
  sitewideReadyForUse: string | null;
  profileUrl: string;
  contaminantsByMedium: Array<{ medium: string; contaminants: string[] }>;
};

export type SearchResult = {
  epaId: string;
  semsSiteId: string;
  name: string;
  city: string | null;
  state: string;
  latitude: number;
  longitude: number;
  nplStatusName: string;
  nplStatusCode: string;
  humanExposureStatus: string | null;
  distanceMiles: number;
};

export type SearchResponse = {
  point: { latitude: number; longitude: number; matchedAddress: string };
  radiusMiles: number;
  outsideRadius: boolean;
  results: SearchResult[];
};
