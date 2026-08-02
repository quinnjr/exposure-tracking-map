import { expect, test } from "@playwright/test";

// Both specs are hermetic: the basemap style/tiles are the only remaining live
// dependency the app has, and these routes intercept them rather than letting
// the run depend on tiles.openfreemap.org being reachable. See the comment on
// the stubbed geocoder spec in search.spec.ts for the same rationale.
test.describe("map failure banner", () => {
  test("shows the banner when the basemap never loads", async ({ page }) => {
    // Style, sprite, glyph, and tile requests all fail permanently, so
    // MapLibre emits 'error' and never reaches 'load'.
    await page.route("https://tiles.openfreemap.org/**", (route) =>
      route.abort(),
    );

    await page.goto("/");

    await expect(page.getByTestId("map-failed")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("map-failed")).toContainText(
      /results list still works/i,
    );
    // The map failing must not take the accessible path down with it: the
    // lookup form in the left rail is the non-canvas route to the same data.
    await expect(page.getByLabel("Address line 1")).toBeVisible();
    await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  });

  // REGRESSION PIN for the mapFailed latch.
  //
  // MapLibre routinely emits non-fatal 'error' events while a style is still
  // coming up — a tile or glyph range that 404s — and the component records
  // those as a *provisional* failure. Before the fix, mapFailed was a one-way
  // latch: any such error permanently pinned the banner over a perfectly good
  // map. The 'load' handler now clears it. If the `mapFailed = false` in that
  // handler is removed, this spec fails.
  //
  // The whole basemap is stubbed so the ordering is deterministic rather than
  // a race, and so the spec stays hermetic:
  //   * the style JSON is served locally and parses immediately, which is what
  //     kicks off tile loading;
  //   * its first few raster tile requests are aborted, so a non-fatal 'error'
  //     fires right away while `ready` is still false — the provisional
  //     failure — after which tiles are served normally;
  //   * its sprite is held for SPRITE_DELAY_MS before being fulfilled. MapLibre
  //     will not fire 'load' until the sprite resolves, so the error above is
  //     guaranteed to land first. The sprite then succeeds and 'load' fires.
  test("does not show the banner when a pre-load tile error is followed by a successful load", async ({
    page,
  }) => {
    const SPRITE_DELAY_MS = 2500;
    const TILE_URL = "https://basemap.test/tiles/{z}/{x}/{y}.png";
    const SPRITE_URL = "https://basemap.test/sprite";

    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.text().includes("[map]")) warnings.push(msg.text());
    });

    await page.route("https://tiles.openfreemap.org/styles/liberty", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 8,
          name: "e2e-stub",
          sprite: SPRITE_URL,
          glyphs: "https://basemap.test/fonts/{fontstack}/{range}.pbf",
          sources: {
            basemap: {
              type: "raster",
              tiles: [TILE_URL],
              tileSize: 256,
              attribution: "OpenStreetMap",
            },
          },
          layers: [
            {
              id: "bg",
              type: "background",
              paint: { "background-color": "#e8e6e1" },
            },
            { id: "basemap", type: "raster", source: "basemap" },
          ],
        }),
      }),
    );

    // A 1x1 transparent PNG: a valid empty sprite sheet, and a valid raster tile.
    const pngPixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
      "base64",
    );
    let spritesServed = 0;
    await page.route("https://basemap.test/sprite*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SPRITE_DELAY_MS));
      spritesServed += 1;
      if (route.request().url().endsWith(".png")) {
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          body: pngPixel,
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    });

    // Only the first few tile requests fail; MapLibre retries and the source
    // then settles, which it must do for the map to reach 'load'.
    let tilesAborted = 0;
    await page.route("https://basemap.test/tiles/**", async (route) => {
      if (tilesAborted < 4) {
        tilesAborted += 1;
        await route.abort();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: pngPixel,
      });
    });

    await page.goto("/");

    // The aborted tiles must first put the component into its provisional
    // failure state, otherwise there is no latch left to pin.
    await expect(page.getByTestId("map-failed")).toBeVisible({
      timeout: 20_000,
    });
    expect(tilesAborted).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0);

    // Now the sprite lands and MapLibre fires 'load'.
    await expect
      .poll(() => spritesServed, { timeout: 20_000 })
      .toBeGreaterThan(0);

    // The banner can only clear from inside the 'load' handler, so it going
    // away is simultaneously proof that 'load' ran to completion and that the
    // provisional failure was not latched. Before the fix it never cleared.
    await expect(page.getByTestId("map-failed")).not.toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  });
});
