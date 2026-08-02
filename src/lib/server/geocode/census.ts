export type GeocodeResult = {
  latitude: number;
  longitude: number;
  matchedAddress: string;
  provider: string;
};

/** The address could not be matched. Permanent for this input; do not retry. */
export class GeocodeNotFoundError extends Error {
  public constructor(address: string) {
    super(`No match for address: ${address}`);
    this.name = 'GeocodeNotFoundError';
  }
}

/** The geocoder itself failed. Transient; safe to retry, must not be cached. */
export class GeocoderUnavailableError extends Error {
  public constructor(cause: string) {
    super(`Geocoder unavailable: ${cause}`);
    this.name = 'GeocoderUnavailableError';
  }
}

const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

/** Cache key: case- and whitespace-insensitive. */
export function normalizeQuery(address: string): string {
  return address.trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

type CensusResponse = {
  result?: {
    addressMatches?: Array<{
      matchedAddress?: string;
      coordinates?: { x?: number; y?: number };
    }>;
  };
};

export async function geocodeWithCensus(
  address: string,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<GeocodeResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  if (normalizeQuery(address) === '') throw new GeocodeNotFoundError(address);

  const url = `${ENDPOINT}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;

  let body: CensusResponse;
  try {
    const res = await doFetch(url);
    if (!res.ok) throw new GeocoderUnavailableError(`HTTP ${res.status}`);
    body = (await res.json()) as CensusResponse;
  } catch (error) {
    if (error instanceof GeocoderUnavailableError) throw error;
    throw new GeocoderUnavailableError(error instanceof Error ? error.message : String(error));
  }

  const match = body.result?.addressMatches?.[0];
  // Census's x is LONGITUDE and y is LATITUDE. Do not swap these.
  const longitude = match?.coordinates?.x;
  const latitude = match?.coordinates?.y;

  if (!match || typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new GeocodeNotFoundError(address);
  }

  return {
    latitude,
    longitude,
    matchedAddress: match.matchedAddress ?? address,
    provider: 'census'
  };
}
