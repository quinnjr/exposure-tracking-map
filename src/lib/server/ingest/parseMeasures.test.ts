import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { healthEnvUrlFor, parseMeasures } from './parseMeasures';

// measures-no-table.html is derived from the real measures-linemaster.html
// capture (site 0100041) with only the Performance Measures <table>...</table>
// element removed by a script (a regex matching <table> blocks whose header
// contains "Performance"..."Measure", the same test the parser itself uses).
// Every other byte of the real page — chrome, headings, nav, footer, the
// "Performance Measures" section intro prose — is left intact. This exercises
// a realistic SiteProfiles Healthenv page that renders normally but has no
// measures table, rather than arbitrary/unrelated HTML.

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('healthEnvUrlFor', () => {
  it('targets the Healthenv fuseaction, not the cleanup page', () => {
    const url = healthEnvUrlFor('0100041');
    expect(url).toContain('fuseaction=second.Healthenv');
    expect(url).toContain('id=0100041');
  });
});

describe('parseMeasures', () => {
  it('reads all four measures from a real page', () => {
    expect(parseMeasures(fixture('measures-linemaster.html'))).toEqual({
      humanExposureStatus: 'Yes',
      groundwaterMigrationStatus: 'Yes',
      constructionComplete: 'Yes',
      sitewideReadyForUse: 'No'
    });
  });

  it('returns all nulls for a page with no measures table', () => {
    expect(parseMeasures(fixture('measures-no-table.html'))).toEqual({
      humanExposureStatus: null,
      groundwaterMigrationStatus: null,
      constructionComplete: null,
      sitewideReadyForUse: null
    });
  });

  it('ignores the legend column, which repeats the measure phrases', () => {
    // The real page's third cell contains "Insufficient data means that..."
    // and a bare "No means...". A text-level parser would return one of those.
    const result = parseMeasures(fixture('measures-linemaster.html'));
    expect(result.humanExposureStatus).toBe('Yes');
    expect(result.humanExposureStatus).not.toContain('means');
  });

  it('handles the groundwater-specific value', () => {
    const html = `
      <table><thead><tr><th>Performance<br/>Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
      <tbody>
        <tr><td>Human Exposure Under Control</td><td> No </td><td><strong>Yes</strong> means blah</td></tr>
        <tr><td>Groundwater Migration Under Control</td><td>Not a Groundwater Site</td><td>legend</td></tr>
      </tbody></table>`;
    const r = parseMeasures(html);
    expect(r.humanExposureStatus).toBe('No');
    expect(r.groundwaterMigrationStatus).toBe('Not a Groundwater Site');
  });

  it('handles Insufficient Data and Status Unavailable', () => {
    const html = `
      <table><thead><tr><th>Performance Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
      <tbody>
        <tr><td>Human Exposure Under Control</td><td>Insufficient Data</td><td>legend</td></tr>
        <tr><td>Groundwater Migration Under Control</td><td>Status Unavailable</td><td>legend</td></tr>
      </tbody></table>`;
    const r = parseMeasures(html);
    expect(r.humanExposureStatus).toBe('Insufficient Data');
    expect(r.groundwaterMigrationStatus).toBe('Status Unavailable');
  });

  it('strips nested markup and collapses whitespace in a status cell', () => {
    const html = `
      <table><thead><tr><th>Performance Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
      <tbody><tr><td>Construction Complete</td><td>\n  <strong>Yes</strong>\n </td><td>legend</td></tr></tbody></table>`;
    expect(parseMeasures(html).constructionComplete).toBe('Yes');
  });

  it('decodes HTML entities', () => {
    const html = `
      <table><thead><tr><th>Performance Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
      <tbody><tr><td>Human&nbsp;Exposure Under Control</td><td>Yes</td><td>legend</td></tr></tbody></table>`;
    expect(parseMeasures(html).humanExposureStatus).toBe('Yes');
  });

  it('decodes a BMP numeric entity', () => {
    const html = `
      <table><thead><tr><th>Performance Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
      <tbody><tr><td>Human Exposure Under Control</td><td>Yes &#8212; verified</td><td>legend</td></tr></tbody></table>`;
    expect(parseMeasures(html).humanExposureStatus).toBe('Yes — verified');
  });

  it('decodes a numeric entity above U+FFFF as one code point, not modulo 65536', () => {
    const html = `
      <table><thead><tr><th>Performance Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
      <tbody><tr><td>Human Exposure Under Control</td><td>Yes &#128512;</td><td>legend</td></tr></tbody></table>`;
    const status = parseMeasures(html).humanExposureStatus;
    expect(status).toContain('\u{1F600}');
    // The whole point of this test: fromCharCode(128512) wraps to U+F600, so
    // this assertion is what fails on the pre-fix code and passes on the fix.
    // fromCharCode is the OLD behaviour this assertion exists to reject;
    // using fromCodePoint here would make the test tautological.
    // eslint-disable-next-line unicorn/prefer-code-point
    expect(status).not.toContain(String.fromCharCode(128_512));
  });

  it('leaves out-of-range numeric entities intact rather than throwing', () => {
    // 1114112 is 0x110000, one past the maximum code point; 99999999 is far past.
    for (const entity of ['&#1114112;', '&#99999999;']) {
      const html = `
        <table><thead><tr><th>Performance Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
        <tbody><tr><td>Human Exposure Under Control</td><td>Yes ${entity}</td><td>legend</td></tr></tbody></table>`;
      let status: string | null = null;
      expect(() => {
        status = parseMeasures(html).humanExposureStatus;
      }).not.toThrow();
      expect(status).toBe(`Yes ${entity}`);
    }
  });

  it('does not throw on a lone surrogate entity', () => {
    const html = `
      <table><thead><tr><th>Performance Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
      <tbody><tr><td>Human Exposure Under Control</td><td>Yes &#55296;</td><td>legend</td></tr></tbody></table>`;
    expect(() => parseMeasures(html)).not.toThrow();
    expect(parseMeasures(html).humanExposureStatus).toBe('Yes &#55296;');
  });

  it('collapses generous internal/surrounding whitespace to an exact trimmed value', () => {
    // statusColors.ts's MAPLIBRE_COLOR_EXPRESSION matches status strings literally
    // and cannot call trim() — MapLibre's expression language has no such
    // operator. Map pin colour correctness therefore depends entirely on
    // cellText() (used here) collapsing whitespace before the value is ever
    // persisted; exposureColor() in JS only trims defensively for the legend
    // and list. This test pins that upstream invariant.
    const html = `
      <table><thead><tr><th>Performance Measure</th><th>Status</th><th>What does this mean?</th></tr></thead>
      <tbody><tr><td>Human Exposure Under Control</td><td>
          \n   Yes  \n
        </td><td>legend</td></tr></tbody></table>`;
    expect(parseMeasures(html).humanExposureStatus).toBe('Yes');
  });

  it('returns nulls rather than throwing on empty or garbage input', () => {
    for (const input of ['', '<html></html>', 'not html at all']) {
      expect(parseMeasures(input).humanExposureStatus).toBeNull();
    }
  });
});
