import { prisma } from '$lib/server/prisma';
import { stateSummaries } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

/** Hub page. Its real job is to give crawlers a path from `/` to all 1,840
 *  site pages in two hops, which a canvas full of map pins cannot do. */
export const load: PageServerLoad = async ({ setHeaders }) => {
  const states = await stateSummaries(prisma);
  setHeaders({ 'cache-control': 'public, max-age=3600' });
  return { states, total: states.reduce((n, s) => n + s.siteCount, 0) };
};
