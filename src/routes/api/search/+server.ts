import { error, json } from '@sveltejs/kit';
import { GeocodeNotFoundError, GeocoderUnavailableError } from '$lib/server/geocode';
import { prisma } from '$lib/server/prisma';
import { DEFAULT_RADIUS_MILES, isValidRadius } from '$lib/server/proximity';
import { searchSites } from '$lib/server/search';
import type { RequestHandler } from './$types';

// No real US street address needs more than this. Without a cap, a script
// can grow GeocodeCache unboundedly (one row per distinct input) and proxy
// unlimited traffic to the Census geocoder through this endpoint.
const MAX_ADDRESS_LENGTH = 200;

export const POST: RequestHandler = async ({ request }) => {
  let body: { address?: unknown; radiusMiles?: unknown };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Request body must be JSON');
  }

  const address = typeof body.address === 'string' ? body.address.trim() : '';
  if (address === '') throw error(400, 'Please enter an address');
  if (address.length > MAX_ADDRESS_LENGTH) {
    throw error(400, `Address must be ${MAX_ADDRESS_LENGTH} characters or fewer`);
  }

  const radiusMiles = body.radiusMiles ?? DEFAULT_RADIUS_MILES;
  if (!isValidRadius(radiusMiles)) throw error(400, 'Unsupported search radius');

  try {
    return json(await searchSites(prisma, { address, radiusMiles }));
  } catch (err) {
    if (err instanceof GeocodeNotFoundError) {
      throw error(422, "We couldn't find that address. Try adding a city and state.");
    }
    if (err instanceof GeocoderUnavailableError) {
      throw error(503, 'The address lookup service is unavailable. Please try again.');
    }
    throw err;
  }
};
