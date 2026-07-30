import { expect, test } from '@playwright/test';

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
    await page.getByLabel('Street address, city, and state').fill(
      '1600 Pennsylvania Avenue NW, Washington, DC 20500'
    );
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
    await page.getByLabel('Street address, city, and state').fill(
      '1600 Pennsylvania Avenue NW, Washington, DC 20500'
    );
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
  // 5-mile radius, is outside range of all fixture sites — nearest is ~186.5
  // mi away, well past 5 mi, so this reliably exercises the empty-radius path.
  test('reports the empty-radius case honestly with nearest sites', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Street address, city, and state').fill(
      '100 2nd Avenue, Glasgow, MT 59230'
    );
    await page.getByLabel('Search radius in miles').selectOption('5');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText(/Nothing within 5 miles/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('result-row')).toHaveCount(3);
  });

  test('shows a clear message for an unmatchable address', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Street address, city, and state').fill('zzzz not a real address zzzz');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText(/couldn't find that address/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('result-row')).toHaveCount(0);
  });

  test('results list rows are keyboard reachable', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Street address, city, and state').fill(
      '1600 Pennsylvania Avenue NW, Washington, DC 20500'
    );
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByTestId('result-row').first()).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('result-row').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('site-dialog')).toBeVisible();
  });
});
