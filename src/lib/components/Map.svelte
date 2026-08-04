<!-- src/lib/components/Map.svelte -->
<script lang="ts">
  import { circlePolygon } from '$lib/geo/circle';
  import type { LatLng } from '$lib/geo/types';
  import { DEFAULT_RADIUS_MILES } from '$lib/radius';
  import { MAPLIBRE_COLOR_EXPRESSION } from '$lib/statusColors';
  import type { SiteFeatureCollection } from '$lib/types';
  import * as maplibregl from 'maplibre-gl';
  import type { GeoJSONSource, LngLat, Map as MapLibreMap } from 'maplibre-gl';
  // MapLibre locates its worker by resolving `maplibre-gl-worker.mjs` against
  // its own `import.meta.url`. That only holds when the package ships as its
  // own sibling files; once Rollup inlines the library into an app chunk the
  // derived URL points at `/_app/immutable/nodes/maplibre-gl-worker.mjs`, which
  // was never emitted — a 404, no worker, and a basemap with no pins on it.
  // The worker is not self-contained either (it imports
  // `./maplibre-gl-shared.mjs`), so copying the file as a plain asset would
  // only move the 404. `?worker&url` makes Vite bundle the worker *and* its
  // imports into one emitted chunk and hand back its real URL.
  import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import Legend from './Legend.svelte';

  // MapLibre spawns the worker with `{ type: 'module' }`, which is why
  // `worker.format` is `es` in vite.config.ts. Must be set before the first
  // `new maplibregl.Map()`.
  maplibregl.setWorkerUrl(maplibreWorkerUrl);

  type Props = {
    features: SiteFeatureCollection;
    searchPoint?: (LatLng & { matchedAddress: string }) | null;
    radiusMiles?: number;
    selectedEpaId?: string | null;
    onSelect?: (epaId: string) => void;
  };

  let {
    features,
    searchPoint = null,
    radiusMiles = DEFAULT_RADIUS_MILES,
    selectedEpaId = null,
    onSelect
  }: Props = $props();

  const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
  const EMPTY = { type: 'FeatureCollection' as const, features: [] };
  // Whole-US view including Alaska, Hawaii, and the territories.
  const INITIAL = { center: [-98.5, 39.8] as [number, number], zoom: 3.2 };

  let container: HTMLDivElement;
  let map: MapLibreMap | null = null;
  let ready = $state(false);
  let mapFailed = $state(false);

  function addLayers(m: MapLibreMap): void {
    m.addSource('sites', {
      type: 'geojson',
      data: features,
      cluster: true,
      clusterRadius: 44,
      clusterMaxZoom: 9
    });
    m.addSource('radius', { type: 'geojson', data: EMPTY });
    m.addSource('origin', { type: 'geojson', data: EMPTY });

    m.addLayer({
      id: 'radius-fill',
      type: 'fill',
      source: 'radius',
      paint: { 'fill-color': '#0f172a', 'fill-opacity': 0.06 }
    });
    m.addLayer({
      id: 'radius-line',
      type: 'line',
      source: 'radius',
      paint: { 'line-color': '#0f172a', 'line-width': 1.5, 'line-dasharray': [2, 2] }
    });

    m.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'sites',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#0f172a',
        'circle-opacity': 0.85,
        'circle-radius': ['step', ['get', 'point_count'], 14, 25, 19, 100, 25]
      }
    });
    m.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'sites',
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
      paint: { 'text-color': '#ffffff' }
    });

    m.addLayer({
      id: 'site-pins',
      type: 'circle',
      source: 'sites',
      filter: ['!', ['has', 'point_count']],
      paint: {
        // Deleted sites render hollow so colour is not the only channel.
        // MAPLIBRE_COLOR_EXPRESSION is intentionally untyped (see statusColors.ts)
        // so this module doesn't depend on MapLibre's style-spec types; cast at
        // the point of use, same as the `as never` casts below for setData().
        'circle-color': [
          'case',
          ['==', ['get', 'nplStatusCode'], 'D'],
          '#ffffff',
          MAPLIBRE_COLOR_EXPRESSION
        ] as never,
        'circle-radius': 6,
        'circle-stroke-width': 2,
        'circle-stroke-color': MAPLIBRE_COLOR_EXPRESSION as never
      }
    });

    m.addLayer({
      id: 'origin-pin',
      type: 'circle',
      source: 'origin',
      paint: {
        'circle-color': '#0f172a',
        'circle-radius': 7,
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff'
      }
    });

    m.on('click', 'site-pins', (e) => {
      const epaId = e.features?.[0]?.properties?.epaId;
      if (typeof epaId === 'string') onSelect?.(epaId);
    });
    m.on('click', 'clusters', (e) => {
      const zoom = m.getZoom();
      m.easeTo({ center: e.lngLat as LngLat, zoom: zoom + 2 });
    });
    for (const layer of ['site-pins', 'clusters']) {
      m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
    }
  }

  // Runs once on mount: it reads no reactive state during tracking (`container`
  // is a plain binding, and `ready` is only read inside deferred MapLibre
  // callbacks), so the cleanup below fires only on component destroy.
  $effect(() => {
    // Set before m.remove() so the 'error' listener, which is still attached
    // while MapLibre aborts in-flight tile/glyph requests, cannot re-latch
    // mapFailed on the way out.
    let disposed = false;

    const m = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: INITIAL.center,
      zoom: INITIAL.zoom,
      attributionControl: { compact: true }
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('error', (e) => {
      console.warn('[map]', e.error);
      // MapLibre emits non-fatal 'error' events during style parsing (e.g. a
      // blocked or 404'd sprite/glyph fetch) well before 'load' fires, so an
      // error alone doesn't mean the style failed to load. Treat a pre-load
      // error as only a *provisional* failure: if the style still finishes
      // loading, the 'load' handler below clears this latch, because errors
      // emitted before 'load' are not necessarily fatal. If 'load' never
      // fires, this stays true and the banner is shown.
      if (!disposed && !ready) mapFailed = true;
    });
    m.on('load', () => {
      try {
        addLayers(m);
        map = m;
        ready = true;
        // A successful load overrides any provisional failure recorded above.
        mapFailed = false;
      } catch (error) {
        // addSource/addLayer can throw on a style-spec rejection (the paint
        // colour expressions are cast, so they are unchecked at compile time).
        // Without this the handler would abort silently: `ready` stays false,
        // every downstream $effect no-ops, and the user gets a bare basemap
        // with no pins and no explanation. This is the one post-load path
        // where the failure latch genuinely should be set.
        console.error('[map] failed to add layers', error);
        mapFailed = true;
      }
    });

    return () => {
      disposed = true;
      ready = false;
      map = null;
      m.remove();
    };
  });

  // Keep the pin source in sync when the feature collection changes.
  $effect(() => {
    if (!ready || !map) return;
    (map.getSource('sites') as GeoJSONSource | undefined)?.setData(features);
  });

  // Draw the radius and origin, and fly to the searched address.
  $effect(() => {
    if (!ready || !map) return;
    const radius = map.getSource('radius') as GeoJSONSource | undefined;
    const origin = map.getSource('origin') as GeoJSONSource | undefined;

    if (!searchPoint) {
      radius?.setData(EMPTY);
      origin?.setData(EMPTY);
      return;
    }

    radius?.setData(circlePolygon(searchPoint, radiusMiles) as never);
    origin?.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [searchPoint.longitude, searchPoint.latitude]
          }
        }
      ]
    } as never);

    // Zoom so the whole radius circle fits, roughly.
    const zoom =
      radiusMiles <= 5 ? 11 : radiusMiles <= 10 ? 10 : radiusMiles <= 25 ? 9 : radiusMiles <= 50 ? 8 : 7;
    map.flyTo({ center: [searchPoint.longitude, searchPoint.latitude], zoom, duration: 900 });
  });

  // Highlight the selected site so keyboard/list-driven selection stays in sync with the map.
  $effect(() => {
    if (!ready || !map) return;
    map.setPaintProperty('site-pins', 'circle-radius', [
      'case',
      ['==', ['get', 'epaId'], selectedEpaId ?? ''],
      9,
      6
    ]);
  });
</script>

<div class="relative size-full">
  <!-- The canvas is not screen-reader navigable; ResultsList is the accessible path. -->
  <div bind:this={container} aria-hidden="true" class="size-full" data-testid="map"></div>
  {#if mapFailed}
    <div
      data-testid="map-failed"
      class="absolute inset-x-0 top-0 m-3 rounded border border-stone-300 bg-white/95 px-3 py-2 text-[13px] font-semibold text-slate-900 shadow-sm"
    >
      ⚠ Map couldn't load. The results list still works.
    </div>
  {/if}
  <Legend />
</div>
