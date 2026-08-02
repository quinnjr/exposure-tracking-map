import type { PrismaClient } from '@prisma/client';

export type {
  SitePinProperties,
  SiteFeature,
  SiteFeatureCollection,
  SiteDetail
} from '$lib/types';
import type { SiteDetail, SiteFeatureCollection } from '$lib/types';

/**
 * Every site as one GeoJSON FeatureCollection. At 1,840 features this is a few
 * hundred kilobytes, so the map loads it once instead of fetching per viewport.
 *
 * GeoJSON coordinate order is [longitude, latitude] — the opposite of how the
 * rest of this codebase writes points.
 */
export async function sitesGeoJson(prisma: PrismaClient): Promise<SiteFeatureCollection> {
  const sites = await prisma.site.findMany({
    select: {
      epaId: true,
      semsSiteId: true,
      name: true,
      city: true,
      state: true,
      latitude: true,
      longitude: true,
      nplStatusCode: true,
      nplStatusName: true,
      humanExposureStatus: true
    }
  });

  return {
    type: 'FeatureCollection',
    features: sites.map((s) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [s.longitude, s.latitude] as [number, number] },
      properties: {
        epaId: s.epaId,
        semsSiteId: s.semsSiteId,
        name: s.name,
        city: s.city,
        state: s.state,
        nplStatusCode: s.nplStatusCode,
        nplStatusName: s.nplStatusName,
        humanExposureStatus: s.humanExposureStatus
      }
    }))
  };
}

export async function siteDetail(
  prisma: PrismaClient,
  epaId: string
): Promise<SiteDetail | null> {
  const site = await prisma.site.findUnique({
    where: { epaId },
    include: { contaminants: { include: { contaminant: true } } }
  });
  if (!site) return null;

  const byMedium = new Map<string, Set<string>>();
  for (const link of site.contaminants) {
    if (!byMedium.has(link.media)) byMedium.set(link.media, new Set());
    byMedium.get(link.media)!.add(link.contaminant.name);
  }

  const contaminantsByMedium = [...byMedium]
    // Sorting a Set<string>; the default lexicographic sort is correct here.
    .map(([medium, names]) => ({ medium, contaminants: [...names].sort() })) // eslint-disable-line unicorn/require-array-sort-compare
    .sort((a, b) => a.medium.localeCompare(b.medium));

  return {
    epaId: site.epaId,
    semsSiteId: site.semsSiteId,
    name: site.name,
    streetAddress: site.streetAddress,
    supplementalAddress: site.supplementalAddress,
    city: site.city,
    county: site.county,
    state: site.state,
    zip: site.zip,
    latitude: site.latitude,
    longitude: site.longitude,
    epaRegion: site.epaRegion,
    nplStatusName: site.nplStatusName,
    nplStatusCode: site.nplStatusCode,
    federalFacility: site.federalFacility,
    humanExposureStatus: site.humanExposureStatus,
    groundwaterMigrationStatus: site.groundwaterMigrationStatus,
    constructionComplete: site.constructionComplete,
    sitewideReadyForUse: site.sitewideReadyForUse,
    profileUrl: site.profileUrl,
    contaminantsByMedium
  };
}

/**
 * Every site reduced to what a sitemap entry needs. Kept separate from
 * sitesGeoJson because the sitemap is requested by crawlers, often, and has no
 * use for coordinates or contaminants — this selects three columns instead of
 * nine.
 *
 * `measuresFetchedAt` stands in for a modified date: the site's own facts come
 * from EPA and carry no timestamp, so the last time this row's exposure
 * measures were scraped is the closest honest answer. It is null for the ~10%
 * of sites whose profile page never yielded a measures table, and those get no
 * <lastmod> rather than a fabricated one.
 */
export async function siteSitemapEntries(
  prisma: PrismaClient
): Promise<Array<{ epaId: string; state: string; measuresFetchedAt: Date | null }>> {
  return prisma.site.findMany({
    select: { epaId: true, state: true, measuresFetchedAt: true },
    orderBy: { epaId: 'asc' }
  });
}

/** One row per state, for the state index and its long-tail landing pages. */
export async function stateSummaries(
  prisma: PrismaClient
): Promise<Array<{ state: string; siteCount: number }>> {
  const grouped = await prisma.site.groupBy({
    by: ['state'],
    _count: { _all: true },
    orderBy: { state: 'asc' }
  });
  return grouped.map((g) => ({ state: g.state, siteCount: g._count._all }));
}

/**
 * Sites in one state, ordered for human reading rather than by id. Powers the
 * `/states/[state]` pages, which exist so that "superfund sites in Connecticut"
 * has something to match — the map alone is a single URL and answers nothing.
 */
export async function sitesInState(
  prisma: PrismaClient,
  state: string
): Promise<
  Array<{
    epaId: string;
    name: string;
    city: string | null;
    county: string | null;
    nplStatusName: string;
    humanExposureStatus: string | null;
  }>
> {
  return prisma.site.findMany({
    where: { state },
    select: {
      epaId: true,
      name: true,
      city: true,
      county: true,
      nplStatusName: true,
      humanExposureStatus: true
    },
    orderBy: [{ city: 'asc' }, { name: 'asc' }]
  });
}
