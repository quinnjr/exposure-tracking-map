import { describe, expect, it } from 'vitest';
import { composeAddress, EMPTY_ADDRESS, isSubmittable, US_STATES } from './address';

const parts = (over: Partial<typeof EMPTY_ADDRESS> = {}) => ({ ...EMPTY_ADDRESS, ...over });

describe('composeAddress', () => {
  it('joins a full address the way the one-line geocoder expects', () => {
    expect(
      composeAddress(
        parts({
          line1: '1600 Pennsylvania Avenue NW',
          city: 'Washington',
          state: 'DC',
          zip: '20500'
        })
      )
    ).toBe('1600 Pennsylvania Avenue NW, Washington, DC 20500');
  });

  it('folds line 2 into the street segment rather than its own comma group', () => {
    expect(
      composeAddress(parts({ line1: '500 Main St', line2: 'Apt 4B', city: 'Boston', state: 'MA' }))
    ).toBe('500 Main St Apt 4B, Boston, MA');
  });

  it('drops blank parts instead of emitting empty segments', () => {
    // ", , DC" is a materially worse geocoder input than "DC".
    expect(composeAddress(parts({ line1: '1 Elm St', state: 'CT' }))).toBe('1 Elm St, CT');
    expect(composeAddress(EMPTY_ADDRESS)).toBe('');
  });

  it('trims each part so stray spaces do not become double separators', () => {
    expect(
      composeAddress(parts({ line1: '  1 Elm St  ', city: ' Hartford ', state: ' CT ', zip: ' 06103 ' }))
    ).toBe('1 Elm St, Hartford, CT 06103');
  });

  it('keeps state and ZIP in one segment, not two', () => {
    const out = composeAddress(parts({ line1: '1 Elm St', city: 'Hartford', state: 'CT', zip: '06103' }));
    expect(out).toContain('CT 06103');
    expect(out).not.toContain('CT, 06103');
  });
});

describe('isSubmittable', () => {
  it('requires a street line — the one-line geocoder cannot match city/state alone', () => {
    expect(isSubmittable(parts({ city: 'Kaktovik', state: 'AK', zip: '99747' }))).toBe(false);
  });

  it('accepts a street plus either a ZIP or a city and state', () => {
    expect(isSubmittable(parts({ line1: '1 Elm St', zip: '06103' }))).toBe(true);
    expect(isSubmittable(parts({ line1: '1 Elm St', city: 'Hartford', state: 'CT' }))).toBe(true);
  });

  it('rejects a street with no region to locate it in', () => {
    expect(isSubmittable(parts({ line1: '1 Elm St' }))).toBe(false);
    expect(isSubmittable(parts({ line1: '1 Elm St', city: 'Hartford' }))).toBe(false);
  });

  it('treats whitespace-only input as empty', () => {
    expect(isSubmittable(parts({ line1: '   ', city: 'Hartford', state: 'CT' }))).toBe(false);
  });
});

describe('US_STATES', () => {
  it('covers the 50 states, DC, and the territories the NPL dataset includes', () => {
    expect(US_STATES).toHaveLength(55);
    for (const code of ['DC', 'PR', 'VI', 'GU', 'MP', 'AK', 'HI']) {
      expect(US_STATES).toContain(code);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(US_STATES).size).toBe(US_STATES.length);
  });
});
