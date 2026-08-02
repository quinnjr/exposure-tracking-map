<!-- src/routes/sites/+page.svelte -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Seo from '$lib/components/Seo.svelte';
  import { absoluteUrl, breadcrumbJsonLd, datasetJsonLd, stateName } from '$lib/seo';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let origin = $derived(page.url.origin);

  let title = $derived(`All ${data.total} US Superfund sites by state | Exposure Tracking Map`);
  let description = $derived(
    `Browse all ${data.total} Superfund sites on the EPA National Priorities List, ` +
      `organised across ${data.states.length} US states and territories. Each site lists its ` +
      `contaminants of concern and whether the EPA has determined human exposure is under control.`
  );

  let breadcrumb = $derived(
    breadcrumbJsonLd(origin, [
      { name: 'Home', path: '/' },
      { name: 'Superfund sites', path: '/sites' }
    ])
  );
</script>

<Seo
  {title}
  {description}
  canonical={absoluteUrl(origin, '/sites')}
  jsonLd={[datasetJsonLd(origin, data.total), breadcrumb]}
/>

<div class="mx-auto max-w-3xl px-4 py-8 text-stone-900">
  <nav aria-label="Breadcrumb" class="mb-4 text-[13px] text-stone-600">
    <a class="underline" href={resolve('/')}>Map</a>
  </nav>

  <h1 class="text-2xl font-semibold tracking-tight">US Superfund sites by state</h1>
  <p class="mt-4 text-[15px] leading-relaxed">{description}</p>

  <ul class="mt-8 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
    {#each data.states as s (s.state)}
      <li class="border-b border-stone-200 py-2">
        <a class="text-[15px] underline" href={resolve('/states/[state]', { state: s.state.toLowerCase() })}>
          {stateName(s.state)}
        </a>
        <span class="text-[13px] text-stone-600"> · {s.siteCount}</span>
      </li>
    {/each}
  </ul>
</div>
