import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  datasetJsonLd,
  exposureSentence,
  stateName,
  titleCase,
  US_STATE_NAMES
} from './seo';

describe('exposureSentence', () => {
  // The whole point of this helper. EPA's raw values are `Yes` / `No` /
  // `Insufficient Data`, and "No" reads as reassurance when it means the
  // opposite — the EPA has NOT determined exposure is controlled. An answer
  // engine quoting the raw field would state the inverse of the truth.
  it('does not let "No" read as "there is no exposure"', () => {
    const sentence = exposureSentence('No', 'ACME SITE');
    expect(sentence).toContain('NOT determined');
    // The negative legitimately ends "...is under control", because it negates
    // the determination rather than the exposure. What must never appear is the
    // affirmative phrasing, which would invert the meaning entirely.
    expect(sentence).not.toContain('has determined');
    expect(sentence).not.toBe(exposureSentence('Yes', 'ACME SITE'));
  });

  it('states the affirmative case plainly', () => {
    expect(exposureSentence('Yes', 'ACME SITE')).toBe(
      'At Acme Site, the EPA has determined that human exposure is under control.'
    );
  });

  it('distinguishes missing data from a negative determination', () => {
    const insufficient = exposureSentence('Insufficient Data', 'ACME SITE');
    const absent = exposureSentence(null, 'ACME SITE');
    expect(insufficient).toContain('insufficient data');
    expect(absent).toContain('has not published');
    expect(insufficient).not.toBe(absent);
  });

  it('is self-contained — it names the site, so it survives being quoted alone', () => {
    for (const status of ['Yes', 'No', 'Insufficient Data', null]) {
      expect(exposureSentence(status, 'ACME SITE')).toContain('Acme Site');
    }
  });
});

describe('titleCase', () => {
  it('de-shouts EPA values', () => {
    expect(titleCase('LINEMASTER SWITCH CORP.')).toBe('Linemaster Switch Corp.');
  });

  it('keeps domain initialisms uppercase', () => {
    expect(titleCase('ACME LLC')).toBe('Acme LLC');
    expect(titleCase('EPA REGION')).toBe('EPA Region');
  });
});

describe('stateName', () => {
  it('expands codes, including territories the NPL covers', () => {
    expect(stateName('CT')).toBe('Connecticut');
    expect(stateName('PR')).toBe('Puerto Rico');
    expect(stateName('DC')).toBe('District of Columbia');
  });

  it('falls back to the code rather than throwing on an unknown value', () => {
    expect(stateName('ZZ')).toBe('ZZ');
  });

  it('covers every state the address form offers, or the two would disagree', () => {
    expect(Object.keys(US_STATE_NAMES)).toHaveLength(55);
  });
});

describe('absoluteUrl', () => {
  it('builds an absolute URL from a request origin', () => {
    expect(absoluteUrl('https://example.com', '/sites/ABC')).toBe('https://example.com/sites/ABC');
  });

  it('works against a localhost origin, so dev and prod emit valid canonicals', () => {
    expect(absoluteUrl('http://localhost:5173', '/sites')).toBe('http://localhost:5173/sites');
  });
});

describe('JSON-LD builders', () => {
  it('datasetJsonLd is valid schema.org and reports the real site count', () => {
    const ld = datasetJsonLd('https://example.com', 1840);
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('Dataset');
    expect(JSON.stringify(ld)).toContain('1840');
    expect((ld.distribution as { contentUrl: string }).contentUrl).toBe(
      'https://example.com/api/sites'
    );
  });

  it('breadcrumb positions are 1-based and absolute, as schema.org requires', () => {
    const ld = breadcrumbJsonLd('https://example.com', [
      { name: 'Home', path: '/' },
      { name: 'Sites', path: '/sites' }
    ]);
    const items = ld.itemListElement as Array<{ position: number; item: string }>;
    expect(items[0].position).toBe(1);
    expect(items[1].item).toBe('https://example.com/sites');
  });

  it('serialises without producing a tag that would close a script block early', () => {
    const serialised = JSON.stringify(datasetJsonLd('https://example.com', 1840));
    expect(serialised).not.toContain('</script');
  });
});
