import { error } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { sitesInState } from '$lib/server/queries';
import { US_STATE_NAMES } from '$lib/seo';
import type { PageServerLoad } from './$types';

/**
 * Long-tail landing pages. "superfund sites in connecticut" is a query a person
 * types; a map at `/` matches nothing in it. One page per state gives that
 * query a document with the answer already written out.
 */
export const load: PageServerLoad = async ({ params, setHeaders }) => {
  const code = params.state.toUpperCase();
  if (!(code in US_STATE_NAMES)) error(404, 'Unknown state');

  const sites = await sitesInState(prisma, code);
  // A state with no NPL sites is a real answer, not a 404 — but there is
  // nothing to index, so let it 404 rather than publish an empty page that
  // dilutes the sitemap.
  if (sites.length === 0) error(404, 'No Superfund sites recorded in this state');

  setHeaders({ 'cache-control': 'public, max-age=3600' });
  return { code, sites };
};
