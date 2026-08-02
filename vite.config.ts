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
  // This only ever affected `pnpm dev`. The production build does not use the
  // optimiser, which is why the E2E suite — which drives a real build behind
  // `vite preview` — passed throughout while the dev server showed a blank map.
  optimizeDeps: { exclude: ['maplibre-gl'] },
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
      'node_modules/**',
      '.svelte-kit/**',
      'build/**',
      // Playwright owns these; Vitest cannot run them.
      'tests/e2e/**'
    ],
    environment: 'node'
  }
});
