export type MeasureMap = {
  humanExposureStatus: string | null;
  groundwaterMigrationStatus: string | null;
  constructionComplete: string | null;
  sitewideReadyForUse: string | null;
};

const HEALTHENV_BASE =
  'https://cumulis.epa.gov/supercpad/SiteProfiles/index.cfm?fuseaction=second.Healthenv&id=';

export function healthEnvUrlFor(semsSiteId: string): string {
  return `${HEALTHENV_BASE}${semsSiteId}`;
}

/** Measure label on the page -> field name in our schema. */
const LABEL_TO_FIELD: Record<string, keyof MeasureMap> = {
  'human exposure under control': 'humanExposureStatus',
  'groundwater migration under control': 'groundwaterMigrationStatus',
  'construction complete': 'constructionComplete',
  'sitewide ready for anticipated use': 'sitewideReadyForUse'
};

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&rsquo;': '’'
};

/** Strip tags, decode the entities EPA actually emits, collapse whitespace. */
function cellText(html: string): string {
  let s = html.replace(/<[^>]*>/g, ' ');
  for (const [entity, char] of Object.entries(ENTITIES)) {
    s = s.split(entity).join(char);
  }
  s = s.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  return s.replace(/\s+/g, ' ').trim();
}

const EMPTY: MeasureMap = {
  humanExposureStatus: null,
  groundwaterMigrationStatus: null,
  constructionComplete: null,
  sitewideReadyForUse: null
};

/**
 * Extract the four performance measures from an EPA site-profile Healthenv page.
 *
 * Structural, not textual, by necessity: the table's third column is a legend
 * that repeats every measure label and every possible status value in prose.
 * We locate the table by its header, then read cell index 1 of each row and
 * discard the rest. Never throws — a page without the table yields all nulls.
 */
export function parseMeasures(html: string): MeasureMap {
  const result: MeasureMap = { ...EMPTY };

  for (const tableMatch of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const table = tableMatch[1];
    // The header spans a <br/>, so match on the words rather than the phrase.
    if (!/Performance[\s\S]{0,40}Measure/i.test(table)) continue;

    for (const rowMatch of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
        cellText(m[1])
      );
      if (cells.length < 2) continue; // header row, or a malformed row

      const field = LABEL_TO_FIELD[cells[0].toLowerCase()];
      if (!field) continue;

      const status = cells[1];
      result[field] = status === '' ? null : status;
    }

    // Found and consumed the measures table; no need to scan further tables.
    if (Object.values(result).some((v) => v !== null)) return result;
  }

  return result;
}
