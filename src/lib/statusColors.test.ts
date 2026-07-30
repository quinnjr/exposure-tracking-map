import { describe, expect, it } from 'vitest';
import {
  EXPOSURE_COLORS,
  EXPOSURE_LEGEND,
  MAPLIBRE_COLOR_EXPRESSION,
  exposureColor,
  UNKNOWN_COLOR
} from './statusColors';

describe('exposureColor', () => {
  it('maps every verified status value', () => {
    expect(exposureColor('Yes')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(exposureColor('No')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(exposureColor('Insufficient Data')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('gives every status a distinct colour', () => {
    const colors = ['Yes', 'No', 'Insufficient Data'].map(exposureColor);
    expect(new Set(colors).size).toBe(3);
  });

  it('falls back to the unknown colour for null', () => {
    expect(exposureColor(null)).toBe(UNKNOWN_COLOR);
  });

  it('falls back for Status Unavailable and any future unseen value', () => {
    expect(exposureColor('Status Unavailable')).toBe(UNKNOWN_COLOR);
    expect(exposureColor('Something EPA Invents In 2027')).toBe(UNKNOWN_COLOR);
  });

  it('is case-insensitive, since EPA capitalisation is inconsistent', () => {
    expect(exposureColor('yes')).toBe(exposureColor('Yes'));
    expect(exposureColor('INSUFFICIENT DATA')).toBe(exposureColor('Insufficient Data'));
  });
});

describe('EXPOSURE_LEGEND', () => {
  it('documents four entries with labels and colours', () => {
    expect(EXPOSURE_LEGEND).toHaveLength(4);
    for (const entry of EXPOSURE_LEGEND) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('MAPLIBRE_COLOR_EXPRESSION', () => {
  it('is a match expression keyed on humanExposureStatus with a fallback', () => {
    expect(MAPLIBRE_COLOR_EXPRESSION[0]).toBe('match');
    expect(JSON.stringify(MAPLIBRE_COLOR_EXPRESSION)).toContain('humanExposureStatus');
    // A match expression's final element is the default.
    expect(MAPLIBRE_COLOR_EXPRESSION.at(-1)).toBe(UNKNOWN_COLOR);
  });

  it('matches on a case-normalised property so the map cannot disagree with exposureColor', () => {
    expect(MAPLIBRE_COLOR_EXPRESSION[1]).toEqual([
      'downcase',
      ['to-string', ['get', 'humanExposureStatus']]
    ]);
  });

  it('derives its labels from EXPOSURE_COLORS, so the two cannot drift', () => {
    // Labels sit at odd indices between the match input and the trailing default.
    const body = MAPLIBRE_COLOR_EXPRESSION.slice(2, -1);
    const labels = body.filter((_, i) => i % 2 === 0);
    expect(labels).toEqual(Object.keys(EXPOSURE_COLORS));
    expect(MAPLIBRE_COLOR_EXPRESSION.at(-1)).toBe(UNKNOWN_COLOR);
  });
});
