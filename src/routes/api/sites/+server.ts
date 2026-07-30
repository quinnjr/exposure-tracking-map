import { json } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { sitesGeoJson } from '$lib/server/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const fc = await sitesGeoJson(prisma);
  return json(fc, {
    // The dataset changes only when the downloader runs.
    headers: { 'cache-control': 'public, max-age=3600' }
  });
};
