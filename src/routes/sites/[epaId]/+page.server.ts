import { error } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { siteDetail } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

/**
 * Server-rendered, deliberately. The map dialog fetches the same data on the
 * client, which is fine for a person who is already looking at the map and
 * useless to anything that reads HTML — a crawler or an answer engine sees an
 * empty shell. This route is the crawlable twin of that dialog.
 */
export const load: PageServerLoad = async ({ params, setHeaders }) => {
  const detail = await siteDetail(prisma, params.epaId);
  if (!detail) error(404, 'Site not found');

  // The underlying facts change only when the downloader runs, so this is
  // cheaply cacheable and keeps 1,840 crawlable pages from becoming 1,840
  // database round-trips every time a bot sweeps the sitemap.
  setHeaders({ 'cache-control': 'public, max-age=3600' });

  return { detail };
};
