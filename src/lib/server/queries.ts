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

  const contaminantsByMedium = [...byMedium.entries()]
    .map(([medium, names]) => ({ medium, contaminants: [...names].sort() }))
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
