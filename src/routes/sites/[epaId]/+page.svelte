<!-- src/routes/sites/[epaId]/+page.svelte -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Seo from '$lib/components/Seo.svelte';
  import {
    absoluteUrl,
    breadcrumbJsonLd,
    exposureSentence,
    stateName,
    titleCase
  } from '$lib/seo';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let site = $derived(data.detail);

  let origin = $derived(page.url.origin);
  let name = $derived(titleCase(site.name));
  let place = $derived([site.city && titleCase(site.city), site.state].filter(Boolean).join(', '));
  let allContaminants = $derived(site.contaminantsByMedium.flatMap((g) => g.contaminants));

  let title = $derived(`${name} — Superfund site in ${place} | Exposure Tracking Map`);

  /**
   * Written to survive extraction. An answer engine lifts one or two sentences
   * away from the page, so the description states the facts a person actually
   * asked about — where it is, whether exposure is controlled, what is in the
   * ground — rather than describing the page.
   */
  let description = $derived(
    `${name} is a Superfund site in ${place} on the EPA National Priorities List (${site.nplStatusName}). ` +
      (allContaminants.length > 0
        ? `Contaminants of concern include ${allContaminants.slice(0, 4).join(', ')}. `
        : '') +
      exposureSentence(site.humanExposureStatus, site.name)
  );

  // Place, not Dataset: this page is about one location. `additionalProperty`
  // carries the EPA status fields, which have no schema.org equivalent but are
  // exactly what an answer engine is asked to report.
  let placeJsonLd = $derived({
    '@context': 'https://schema.org',
    '@type': 'Place',
    '@id': absoluteUrl(origin, `/sites/${site.epaId}`),
    name,
    url: absoluteUrl(origin, `/sites/${site.epaId}`),
    description,
    geo: {
      '@type': 'GeoCoordinates',
      latitude: site.latitude,
      longitude: site.longitude
    },
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.streetAddress ?? undefined,
      addressLocality: site.city ? titleCase(site.city) : undefined,
      addressRegion: site.state,
      postalCode: site.zip ?? undefined,
      addressCountry: 'US'
    },
    identifier: [
      { '@type': 'PropertyValue', propertyID: 'EPA ID', value: site.epaId },
      { '@type': 'PropertyValue', propertyID: 'SEMS Site ID', value: site.semsSiteId }
    ],
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'NPL status', value: site.nplStatusName },
      {
        '@type': 'PropertyValue',
        name: 'Human exposure under control',
        value: site.humanExposureStatus ?? 'Not reported'
      },
      {
        '@type': 'PropertyValue',
        name: 'Groundwater migration under control',
        value: site.groundwaterMigrationStatus ?? 'Not reported'
      },
      {
        '@type': 'PropertyValue',
        name: 'Construction complete',
        value: site.constructionComplete ?? 'Not reported'
      },
      { '@type': 'PropertyValue', name: 'Federal facility', value: site.federalFacility ? 'Yes' : 'No' },
      ...allContaminants.map((c) => ({
        '@type': 'PropertyValue',
        name: 'Contaminant of concern',
        value: titleCase(c)
      }))
    ],
    isAccessibleForFree: true,
    sameAs: site.profileUrl
  });

  // The questions people actually type. FAQPage is the structure answer engines
  // most reliably extract, and each answer is self-contained on purpose.
  let faqJsonLd = $derived({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `Where is ${name}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `${name} is a Superfund site in ${place}${site.county ? ` (${titleCase(site.county)} County)` : ''}, at latitude ${site.latitude}, longitude ${site.longitude}.`
        }
      },
      {
        '@type': 'Question',
        name: `Is human exposure under control at ${name}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: exposureSentence(site.humanExposureStatus, site.name)
        }
      },
      ...(allContaminants.length > 0
        ? [
            {
              '@type': 'Question',
              name: `What contaminants are at ${name}?`,
              acceptedAnswer: {
                '@type': 'Answer',
                text: `Contaminants of concern recorded by the EPA at ${name} include ${allContaminants.map((c) => titleCase(c)).join(', ')}.`
              }
            }
          ]
        : [])
    ]
  });

  let breadcrumb = $derived(
    breadcrumbJsonLd(origin, [
      { name: 'Home', path: '/' },
      { name: 'Superfund sites', path: '/sites' },
      { name: stateName(site.state), path: `/states/${site.state.toLowerCase()}` },
      { name, path: `/sites/${site.epaId}` }
    ])
  );
</script>

<Seo
  {title}
  {description}
  canonical={absoluteUrl(origin, `/sites/${site.epaId}`)}
  jsonLd={[placeJsonLd, faqJsonLd, breadcrumb]}
/>

<article class="mx-auto max-w-3xl px-4 py-8 text-stone-900">
  <nav aria-label="Breadcrumb" class="mb-4 text-[13px] text-stone-600">
    <a class="underline" href={resolve('/')}>Map</a>
    <span aria-hidden="true"> / </span>
    <a class="underline" href={resolve('/sites')}>Sites</a>
    <span aria-hidden="true"> / </span>
    <a class="underline" href={resolve('/states/[state]', { state: site.state.toLowerCase() })}>{stateName(site.state)}</a>
  </nav>

  <h1 class="text-2xl font-semibold tracking-tight">{name}</h1>
  <p class="mt-1 text-[15px] text-stone-600">
    Superfund site in {place} · EPA ID {site.epaId}
  </p>

  <!-- The lede repeats the meta description in the body on purpose. An answer
       engine that ignores meta tags still finds the same statement in prose. -->
  <p class="mt-4 text-[15px] leading-relaxed">{description}</p>

  <section class="mt-8">
    <h2 class="text-lg font-semibold">EPA status</h2>
    <dl class="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {#each [['National Priorities List', site.nplStatusName], ['Human exposure under control', site.humanExposureStatus ?? 'Not reported'], ['Groundwater migration under control', site.groundwaterMigrationStatus ?? 'Not reported'], ['Construction complete', site.constructionComplete ?? 'Not reported'], ['Sitewide ready for reuse', site.sitewideReadyForUse ?? 'Not reported'], ['Federal facility', site.federalFacility ? 'Yes' : 'No'], ['EPA region', site.epaRegion ?? 'Not reported'], ['County', site.county ? titleCase(site.county) : 'Not reported']] as [label, value] (label)}
        <div class="border-b border-stone-200 py-1">
          <dt class="text-[12px] font-medium text-stone-600">{label}</dt>
          <dd class="text-[15px]">{value}</dd>
        </div>
      {/each}
    </dl>
  </section>

  {#if site.contaminantsByMedium.length > 0}
    <section class="mt-8">
      <h2 class="text-lg font-semibold">Contaminants of concern</h2>
      <p class="mt-1 text-[13px] text-stone-600">
        Grouped by the environmental medium in which the EPA recorded them.
      </p>
      {#each site.contaminantsByMedium as group (group.medium)}
        <div class="mt-4">
          <h3 class="text-[14px] font-semibold">{group.medium}</h3>
          <ul class="mt-1 flex flex-wrap gap-1">
            {#each group.contaminants as contaminant (contaminant)}
              <li class="rounded bg-stone-100 px-2 py-0.5 text-[13px]">{titleCase(contaminant)}</li>
            {/each}
          </ul>
        </div>
      {/each}
    </section>
  {/if}

  <section class="mt-8">
    <h2 class="text-lg font-semibold">Location</h2>
    <p class="mt-2 text-[15px]">
      {#if site.streetAddress}{site.streetAddress},{/if}
      {place}
      {#if site.zip}{site.zip}{/if}
    </p>
    <p class="mt-1 text-[13px] text-stone-600">
      Latitude {site.latitude}, longitude {site.longitude}
    </p>
    <p class="mt-4">
      <a class="text-[14px] font-medium underline" href={resolve(`/?site=${site.epaId}`)}>
        Show this site on the map →
      </a>
    </p>
  </section>

  <footer class="mt-10 border-t border-stone-200 pt-4 text-[13px] text-stone-600">
    <p>
      Source: US EPA Superfund Enterprise Management System.
      <!-- External EPA URL, not an internal route, so resolve() does not apply. -->
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a class="underline" href={site.profileUrl} rel="noopener noreferrer" target="_blank">
        View the official EPA site profile ↗
      </a>
    </p>
  </footer>
</article>
