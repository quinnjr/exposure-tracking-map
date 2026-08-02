/**
 * Colour per verified Human Exposure Under Control value. These four hues are
 * reserved for exposure status and used nowhere else in the UI, so colour
 * always carries the same meaning.
 */
export const EXPOSURE_COLORS = {
  yes: '#15803d',
  no: '#b91c1c',
  'insufficient data': '#b45309'
} as const;

/** Used for `Status Unavailable`, null, and any value EPA adds later. */
export const UNKNOWN_COLOR = '#57534e';

export function exposureColor(status: string | null | undefined): string {
  if (!status) return UNKNOWN_COLOR;
  const key = status.trim().toLowerCase() as keyof typeof EXPOSURE_COLORS;
  return EXPOSURE_COLORS[key] ?? UNKNOWN_COLOR;
}

export const EXPOSURE_LEGEND = [
  { label: 'Human exposure under control', color: EXPOSURE_COLORS.yes },
  { label: 'Not under control', color: EXPOSURE_COLORS.no },
  { label: 'Insufficient data', color: EXPOSURE_COLORS['insufficient data'] },
  { label: 'Not reported', color: UNKNOWN_COLOR }
] as const;

/**
 * MapLibre `match` over the feature's humanExposureStatus.
 *
 * `to-string` is documented by MapLibre to map a null/absent property to '',
 * which `downcase` then normalises, so this is expected to match the same
 * lowercase keys `exposureColor()` uses. That specific runtime behaviour isn't
 * evaluated by this repo's tests — this module deliberately has no MapLibre
 * dependency (so it stays unit-testable without a real evaluator), and
 * `statusColors.test.ts` only checks the expression's *structure* (that it's a
 * `match` on `downcase(to-string(get(...)))`, with labels derived from
 * EXPOSURE_COLORS and a default of UNKNOWN_COLOR). `exposureColor()` itself is
 * independently unit-tested and guarantees the same UNKNOWN_COLOR fallback for
 * every non-map surface (legend, results list, dialog), so the two are only
 * guaranteed to agree by construction (shared EXPOSURE_COLORS/UNKNOWN_COLOR),
 * not by a test that evaluates this expression through a real MapLibre style.
 * Deriving the label/colour pairs from EXPOSURE_COLORS means the map and the
 * legend can never disagree about a status the way two hand-maintained lists
 * would.
 *
 * One residual gap versus `exposureColor()`: MapLibre has no `trim` operator, so
 * this cannot strip surrounding whitespace the way `exposureColor()` does. That's
 * fine in practice — `parseMeasures`'s `cellText()` already collapses whitespace
 * before anything is stored, so persisted values have no leading/trailing spaces.
 *
 * Typed as `unknown[]` (rather than importing `ExpressionSpecification` from
 * the transitive `@maplibre/maplibre-gl-style-spec` package) so this module
 * has no dependency on MapLibre's type surface; consumers cast at the point
 * of use where MapLibre's own paint-property types apply.
 */
export const MAPLIBRE_COLOR_EXPRESSION = [
  'match',
  ['downcase', ['to-string', ['get', 'humanExposureStatus']]],
  ...Object.entries(EXPOSURE_COLORS).flatMap(([status, color]) => [status, color]),
  UNKNOWN_COLOR
] as unknown[];
