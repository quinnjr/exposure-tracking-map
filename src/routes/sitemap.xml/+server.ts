import { prisma } from '$lib/server/prisma';
import { siteSitemapEntries, stateSummaries } from '$lib/server/queries';
import type { RequestHandler } from './$types';

const escapeXml = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * One sitemap covering every indexable URL: the map, the hub, one page per
 * state, and one per site — ~1,900 entries. Well under the 50,000-URL and
 * 50 MB limits, so it stays a single file rather than an index.
 *
 * Generated rather than static because the set of sites is whatever the last
 * ingest produced; a checked-in sitemap would drift silently the first time
 * EPA adds or delists a site.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
  const [sites, states] = await Promise.all([
    siteSitemapEntries(prisma),
    stateSummaries(prisma)
  ]);

  const origin = url.origin;
  const entry = (path: string, priority: string, lastmod?: Date | null): string =>
    `<url><loc>${escapeXml(new URL(path, origin).href)}</loc>` +
    (lastmod ? `<lastmod>${lastmod.toISOString().split('T', 1)[0]}</lastmod>` : '') +
    `<priority>${priority}</priority></url>`;

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    entry('/', '1.0') +
    entry('/sites', '0.9') +
    states.map((s) => entry(`/states/${s.state.toLowerCase()}`, '0.7')).join('') +
    sites.map((s) => entry(`/sites/${s.epaId}`, '0.6', s.measuresFetchedAt)).join('') +
    '</urlset>';

  setHeaders({ 'content-type': 'application/xml', 'cache-control': 'public, max-age=3600' });
  return new Response(body);
};
