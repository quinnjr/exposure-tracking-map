<!-- src/routes/states/[state]/+page.svelte -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Seo from '$lib/components/Seo.svelte';
  import { absoluteUrl, breadcrumbJsonLd, stateName, titleCase } from '$lib/seo';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let origin = $derived(page.url.origin);
  let name = $derived(stateName(data.code));
  let count = $derived(data.sites.length);

  let uncontrolled = $derived(data.sites.filter((s) => s.humanExposureStatus === 'No').length);

  let title = $derived(`${count} Superfund sites in ${name} | Exposure Tracking Map`);
  let description = $derived(
    `${name} has ${count} Superfund site${count === 1 ? '' : 's'} on the EPA National Priorities List. ` +
      (uncontrolled > 0
        ? `At ${uncontrolled} of them, the EPA has not determined that human exposure is under control. `
        : '') +
      `Browse each site's contaminants of concern and exposure status, or search by address.`
  );

  // ItemList is what an answer engine reads to enumerate "the sites in X".
  let listJsonLd = $derived({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Superfund sites in ${name}`,
    description,
    numberOfItems: count,
    itemListElement: data.sites.map((s, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: titleCase(s.name),
      url: absoluteUrl(origin, `/sites/${s.epaId}`)
    }))
  });

  let breadcrumb = $derived(
    breadcrumbJsonLd(origin, [
      { name: 'Home', path: '/' },
      { name: 'Superfund sites', path: '/sites' },
      { name, path: `/states/${data.code.toLowerCase()}` }
    ])
  );
</script>

<Seo
  {title}
  {description}
  canonical={absoluteUrl(origin, `/states/${data.code.toLowerCase()}`)}
  jsonLd={[listJsonLd, breadcrumb]}
/>

<div class="mx-auto max-w-3xl px-4 py-8 text-stone-900">
  <nav aria-label="Breadcrumb" class="mb-4 text-[13px] text-stone-600">
    <a class="underline" href={resolve('/')}>Map</a>
    <span aria-hidden="true"> / </span>
    <a class="underline" href={resolve('/sites')}>Sites</a>
  </nav>

  <h1 class="text-2xl font-semibold tracking-tight">Superfund sites in {name}</h1>
  <p class="mt-4 text-[15px] leading-relaxed">{description}</p>

  <ul class="mt-8 divide-y divide-stone-200">
    {#each data.sites as site (site.epaId)}
      <li class="py-3">
        <a class="text-[15px] font-medium underline" href={resolve('/sites/[epaId]', { epaId: site.epaId })}>
          {titleCase(site.name)}
        </a>
        <p class="text-[13px] text-stone-600">
          {#if site.city}{titleCase(site.city)}, {/if}{data.code}
          · {site.nplStatusName}
          {#if site.humanExposureStatus === 'No'}
            · <span class="font-medium text-red-700">Human exposure not under control</span>
          {/if}
        </p>
      </li>
    {/each}
  </ul>
</div>
