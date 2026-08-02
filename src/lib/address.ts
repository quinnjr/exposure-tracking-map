/**
 * Structured address entry.
 *
 * The Census geocoder this app uses is the ONE-LINE endpoint, which takes a
 * single string rather than separate fields. So the form collects parts for the
 * user's benefit — browser autofill works properly, and it is obvious what is
 * required — and this module joins them back into the single line the API
 * expects. Keeping the join here rather than inside the component makes it
 * directly testable, which matters because a malformed join is indistinguishable
 * from an unmatchable address once it reaches the geocoder.
 */
export type AddressParts = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
};

export const EMPTY_ADDRESS: AddressParts = {
  line1: '',
  line2: '',
  city: '',
  state: '',
  zip: ''
};

/** US states, DC, and the territories the NPL dataset actually covers. */
export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'GU', 'HI',
  'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'MP', 'OH', 'OK',
  'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'VI', 'WA',
  'WV', 'WI', 'WY'
] as const;

/**
 * Join the parts into the single line the Census one-line geocoder expects,
 * e.g. `1600 Pennsylvania Avenue NW, Washington, DC 20500`.
 *
 * Empty parts are dropped rather than leaving empty segments — `", , DC"` is a
 * materially worse geocoder input than `"DC"`, and users routinely leave line 2
 * blank. State and ZIP share a segment because that is how US addresses are
 * written and how the geocoder parses them.
 */
export function composeAddress(parts: AddressParts): string {
  const street = [parts.line1, parts.line2].map((s) => s.trim()).filter(Boolean).join(' ');
  const region = [parts.state.trim(), parts.zip.trim()].filter(Boolean).join(' ');
  return [street, parts.city.trim(), region].filter(Boolean).join(', ');
}

/**
 * Whether the parts are worth sending. The one-line geocoder needs a street
 * address — city/state alone returns no match — plus something to locate it in,
 * which is either a city and state or a ZIP.
 */
export function isSubmittable(parts: AddressParts): boolean {
  const hasStreet = parts.line1.trim() !== '';
  const hasRegion =
    parts.zip.trim() !== '' || (parts.city.trim() !== '' && parts.state.trim() !== '');
  return hasStreet && hasRegion;
}
