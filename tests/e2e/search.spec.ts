import { expect, type Page, test } from '@playwright/test';

/**
 * The lookup is a structured form in the left rail. `composeAddress` joins the
 * parts into the single line the Census one-line geocoder takes, so the strings
 * these parts produce must match the GeocodeCache rows seeded in
 * tests/seed-fixture.ts exactly — otherwise the cache misses and the spec
 * silently reaches for the live network, which the suite must never do.
 */
async function fillAddress(
  page: Page,
  parts: { line1: string; city?: string; state?: string; zip?: string }
): Promise<void> {
  await page.getByLabel('Address line 1').fill(parts.line1);
  if (parts.city !== undefined) await page.getByLabel('City').fill(parts.city);
  if (parts.state !== undefined) await page.getByLabel('State').selectOption(parts.state);
  if (parts.zip !== undefined) await page.getByLabel('ZIP code').fill(parts.zip);
}

/**
 * Stub the basemap. Without this every spec here fetches the real style, sprite,
 * and vector tiles from tiles.openfreemap.org — which is a live network
 * dependency the suite is supposed to be free of, and the most likely cause of a
 * cold-run first-paint timeout under parallel workers.
 *
 * The style is fulfilled (not aborted) with a valid empty style so `load` still
 * fires and the app behaves exactly as it does normally: layers get added, pins
 * render, no failure banner. Aborting would exercise the failure path instead,
 * which is map-failure.spec.ts's job, not this file's.
 */
test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', async (route) => {
    if (route.request().url().includes('/styles/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: 8, sources: {}, layers: [] })
      });
      return;
    }
    await route.abort();
  });
});

const WHITE_HOUSE = {
  line1: '1600 Pennsylvania Avenue NW',
  city: 'Washington',
  state: 'DC',
  zip: '20500'
};

test.describe('exposure tracking map', () => {
  test('loads the map and pin data', async ({ page }) => {
    const sites = page.waitForResponse('**/api/sites');
    await page.goto('/');
    const body = await (await sites).json();
    expect(body.features.length).toBe(4);
    await expect(page.getByTestId('map')).toBeVisible();
    await expect(page.getByText('Enter an address')).toBeVisible();
  });

  test('searches an address and lists sites nearest first', async ({ page }) => {
    await page.goto('/');
    await fillAddress(page, WHITE_HOUSE);
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText(/sites? within 25 miles/)).toBeVisible({ timeout: 20_000 });

    const rows = page.getByTestId('result-row');
    await expect(rows.first()).toContainText('FIXTURE NEAR SITE');

    // Distances must ascend.
    const texts = await rows.allInnerTexts();
    const distances = texts.map((t) => Number(t.match(/([\d.]+) mi/)![1]));
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(distances[0]).toBeLessThan(5);
  });

  test('opens a dialog with grouped contaminants and measures', async ({ page }) => {
    await page.goto('/');
    await fillAddress(page, WHITE_HOUSE);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByTestId('result-row').first().click();

    const dialog = page.getByTestId('site-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'FIXTURE NEAR SITE' })).toBeVisible();
    await expect(dialog.getByTestId('contaminants')).toContainText('Groundwater');
    await expect(dialog.getByTestId('contaminants')).toContainText('TRICHLOROETHENE');
    await expect(dialog.getByTestId('contaminants')).toContainText('Soil');
    await expect(dialog).toContainText('Human exposure under control');
    await expect(dialog).toContainText('mi away');

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  // Verified against the live Census geocoder (2026-07-30): city/state-only
  // inputs like "Kaktovik, AK 99747" 422 because the one-line geocoder needs a
  // street address. "100 2nd Avenue, Glasgow, MT 59230" matches and, at a
  // 5-mile radius, is outside range of all fixture sites.
  //
  // Glasgow, MT is far from every fixture site: the nearest (FIXTURE MID SITE,
  // in the DC area) is ~1,599 mi away, so a 5-mile radius is guaranteed empty
  // and the nearest-3 fallback must engage. Note this differs from the ~186 mi
  // seen against the real database — that is the distance to the nearest ACTUAL
  // EPA site, whereas this suite seeds only four synthetic fixtures.
  test('reports the empty-radius case honestly with nearest sites', async ({ page }) => {
    await page.goto('/');
    await fillAddress(page, { line1: '100 2nd Avenue', city: 'Glasgow', state: 'MT', zip: '59230' });
    await page.getByLabel('Search radius in miles').selectOption('5');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText(/Nothing within 5 miles/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('result-row')).toHaveCount(3);
  });

  // Stubbed rather than calling the live geocoder. This was the last spec in the
  // suite making a real network request, and it failed deterministically on CI
  // runners while passing locally — a different response from Census, not a
  // regression. The spec's job is the UI's handling of a 422; that the geocoder
  // actually raises GeocodeNotFoundError on zero matches, and that the route
  // maps it to 422, are both covered without the network in
  // census.test.ts and routes/api/search/server.test.ts.
  //
  // With the basemap stub in beforeEach above, this suite is now hermetic in
  // full — app APIs, geocoder, and basemap. Live-network dependence belongs
  // only to the describe.skip'd canary.
  test('shows a clear message for an unmatchable address', async ({ page }) => {
    await page.route('**/api/search', async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          message: "We couldn't find that address. Try adding a city and state."
        })
      });
    });

    await page.goto('/');
    await fillAddress(page, { line1: 'zzzz not a real address zzzz', zip: '00000' });
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText(/couldn't find that address/i)).toBeVisible({ timeout: 20_000 });
    // Distinct from the retryable-outage copy, mirroring the 503 spec's check.
    await expect(page.getByText(/unavailable.*try again/i)).not.toBeVisible();
    await expect(page.getByTestId('result-row')).toHaveCount(0);
  });

  test('shows retryable copy, distinct from the 422 message, on a 503 geocoder outage', async ({
    page
  }) => {
    await page.route('**/api/search', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'The address lookup service is unavailable. Please try again.'
        })
      });
    });

    await page.goto('/');
    await fillAddress(page, WHITE_HOUSE);
    await page.getByRole('button', { name: 'Search' }).click();

    const unavailableMessage = page.getByText(/unavailable.*try again/i);
    await expect(unavailableMessage).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/couldn't find that address/i)).not.toBeVisible();
    await expect(page.getByTestId('result-row')).toHaveCount(0);
  });

  test('shows a generic unreachable-server message on a network failure', async ({ page }) => {
    await page.route('**/api/search', (route) => route.abort());

    await page.goto('/');
    await fillAddress(page, WHITE_HOUSE);
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText(/could not reach the server/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/unavailable.*try again/i)).not.toBeVisible();
    await expect(page.getByText(/couldn't find that address/i)).not.toBeVisible();
    await expect(page.getByTestId('result-row')).toHaveCount(0);
  });

  test('results list rows are keyboard reachable', async ({ page }) => {
    await page.goto('/');
    await fillAddress(page, WHITE_HOUSE);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByTestId('result-row').first()).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('result-row').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('site-dialog')).toBeVisible();
  });
});
