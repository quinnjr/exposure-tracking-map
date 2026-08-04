/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],

  // MapLibre renders in a Web Worker, and Vite's dependency pre-bundler does not
  // emit its worker entry — dev fails with "The file does not exist at
  // node_modules/.vite/deps/maplibre-gl-worker.mjs" and the map renders nothing
  // at all: no basemap, no clusters, no pins. Excluding it from optimisation
  // leaves the package's own ESM worker resolution intact.
  //
  // Excluding it is necessary but not sufficient: it fixes how the worker
  // resolves in dev, while the *production* build broke the same way for a
  // different reason — Rollup inlines MapLibre into an app chunk, so the URL it
  // derives from `import.meta.url` points at a file that was never emitted.
  // `Map.svelte` now calls `setWorkerUrl()` with a Vite-bundled worker, which
  // covers both. The E2E suite did not catch the production case because it
  // stubs the basemap, so no spec ever needed a live worker.
  optimizeDeps: { exclude: ['maplibre-gl'] },

  // MapLibre constructs its worker with `new Worker(url, { type: 'module' })`,
  // so the emitted bundle has to be an ES module. Vite's default is `iife`,
  // which the module-worker constructor rejects.
  worker: { format: 'es' },

  // Adding the `?worker&url` import to Map.svelte flipped `maplibre-gl` from
  // inlined to externalised in the SSR build, so the server bundle began
  // importing it by bare specifier at runtime. The production image deletes
  // that package on purpose (see the Dockerfile prune step, "client-side only;
  // in the browser bundle"), so every render of `/` died with
  // ERR_MODULE_NOT_FOUND while the API routes, which never touch the map, kept
  // serving 200s. Keep it bundled so the SSR output stays self-contained and
  // the prune stays valid.
  ssr: { noExternal: ['maplibre-gl'] },
  test: {
    // Deny-list, not allow-list. This was previously `src/**` only, which meant
    // `scripts/download.test.ts` was collected by no runner at all and silently
    // never ran — the tests existed and proved nothing. Adding `scripts/**`
    // fixed that one instance; enumerating roots would leave the same trap set
    // for the next directory (a file at `tests/*.test.ts` would fall through
    // the gap between this glob and Playwright's `testDir: tests/e2e`).
    // Matching everywhere and excluding deliberately means a new test runs by
    // default, and skipping one has to be a conscious act.
    include: ['**/*.{test,spec}.{js,ts}'],
    exclude: [
      // `**/` matters: a bare `node_modules/**` matches only the top-level one,
      // so a nested tree such as infra/node_modules would have its dependencies'
      // own *.spec.ts files collected and run as if they were ours.
      '**/node_modules/**',
      '.svelte-kit/**',
      'build/**',
      // Playwright owns these; Vitest cannot run them.
      'tests/e2e/**'
    ],
    environment: 'node'
  }
});
