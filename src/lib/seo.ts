/**
 * Shared SEO/AEO helpers.
 *
 * AEO — answer-engine optimisation — is mostly the same discipline as SEO with
 * one shift in emphasis: an answer engine extracts and cites *facts*, so the
 * page has to state them in prose and in structured data rather than render
 * them into a canvas. That is the whole reason the per-site routes exist; the
 * map is a single URL that answers no question a person actually types.
 */

export const SITE_NAME = 'Exposure Tracking Map';

/** Fallback only. Real requests derive the origin from the incoming URL, so
 *  the same build serves correctly from localhost, a preview, or production. */
export const DEFAULT_ORIGIN = 'https://parkinsons.quinnjr.dev';

export const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', GU: 'Guam', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', MP: 'Northern Mariana Islands', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  VI: 'U.S. Virgin Islands', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming'
};

export function stateName(code: string): string {
  return US_STATE_NAMES[code.toUpperCase()] ?? code;
}

/** Title-case a SHOUTED EPA value without mangling the initialisms in it. */
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/\b[a-z]/g, (c) => c.toUpperCase())
    .replaceAll(/\b(Llc|Inc|Usa|Epa|Us)\b/g, (m) => m.toUpperCase());
}

/**
 * Plain-language rendering of EPA's human-exposure field. The raw values are
 * `Yes`, `No`, `Insufficient Data` and null, which mean close to nothing out of
 * context — and "No" reads like reassurance when it is the opposite.
 *
 * Answer engines quote sentences, so this returns one that survives being
 * lifted away from the page around it.
 */
export function exposureSentence(status: string | null | undefined, siteName: string): string {
  const name = titleCase(siteName);
  switch (status) {
    case 'Yes': {
      return `At ${name}, the EPA has determined that human exposure is under control.`;
    }
    case 'No': {
      return `At ${name}, the EPA has NOT determined that human exposure is under control.`;
    }
    case 'Insufficient Data': {
      return `The EPA reports insufficient data to determine whether human exposure is under control at ${name}.`;
    }
    default: {
      return `The EPA has not published a human-exposure determination for ${name}.`;
    }
  }
}

export type SeoMeta = {
  title: string;
  description: string;
  canonical: string;
  /** JSON-LD graph objects, serialised into one <script> by the Seo component. */
  jsonLd?: unknown[];
  robots?: string;
};

export function absoluteUrl(origin: string, path: string): string {
  return new URL(path, origin).href;
}

/** schema.org Dataset for the corpus as a whole. Dataset is the type answer
 *  engines and Google's dataset search actually understand for this content. */
export function datasetJsonLd(origin: string, siteCount: number): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'US Superfund (NPL) sites with contaminants and human-exposure status',
    description:
      `Location, contaminants of concern, and EPA human-exposure status for ${siteCount} ` +
      'Superfund sites on the US National Priorities List, searchable by distance from any US address.',
    url: origin,
    keywords: [
      'Superfund',
      'National Priorities List',
      'environmental contamination',
      'human exposure',
      'EPA',
      'groundwater contamination'
    ],
    creator: { '@type': 'Organization', name: 'US Environmental Protection Agency' },
    isAccessibleForFree: true,
    license: 'https://www.epa.gov/web-policies-and-procedures/epa-web-policy',
    spatialCoverage: { '@type': 'Place', name: 'United States' },
    distribution: {
      '@type': 'DataDownload',
      encodingFormat: 'application/geo+json',
      contentUrl: absoluteUrl(origin, '/api/sites')
    }
  };
}

export function websiteJsonLd(origin: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: origin,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: absoluteUrl(origin, '/sites?q={search_term_string}') },
      'query-input': 'required name=search_term_string'
    }
  };
}

export function breadcrumbJsonLd(
  origin: string,
  trail: Array<{ name: string; path: string }>
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((c, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: c.name,
      item: absoluteUrl(origin, c.path)
    }))
  };
}
