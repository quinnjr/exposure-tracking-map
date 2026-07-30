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
