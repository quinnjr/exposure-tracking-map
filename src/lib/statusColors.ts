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
 * `to-string` maps a null/absent property to '' and `downcase` normalises casing,
 * so this matches the same lowercase keys `exposureColor()` uses. Deriving the
 * label/colour pairs from EXPOSURE_COLORS means the map and the legend can never
 * disagree about a status the way two hand-maintained lists would.
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
