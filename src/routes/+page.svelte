<!-- src/routes/+page.svelte -->
<script lang="ts">
  import AddressSearch from '$lib/components/AddressSearch.svelte';
  import Map from '$lib/components/Map.svelte';
  import ResultsList from '$lib/components/ResultsList.svelte';
  import { DEFAULT_RADIUS_MILES } from '$lib/radius';
  import type { SearchResponse, SiteFeatureCollection } from '$lib/types';
  import { onMount } from 'svelte';

  let features = $state<SiteFeatureCollection>({ type: 'FeatureCollection', features: [] });
  let address = $state('');
  let radiusMiles = $state<number>(DEFAULT_RADIUS_MILES);
  let response = $state<SearchResponse | null>(null);
  let selectedEpaId = $state<string | null>(null);
  let loading = $state(false);
  let errorMessage = $state<string | null>(null);

  onMount(async () => {
    try {
      const res = await fetch('/api/sites');
      if (res.ok) features = await res.json();
    } catch {
      errorMessage = 'Could not load the Superfund site map.';
    }
  });

  async function search(nextAddress: string, nextRadius: number): Promise<void> {
    loading = true;
    errorMessage = null;
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: nextAddress, radiusMiles: nextRadius })
      });

      if (res.ok) {
        response = await res.json();
      } else {
        response = null;
        const body = await res.json().catch(() => null);
        errorMessage = body?.message ?? 'Something went wrong with that search.';
      }
    } catch {
      response = null;
      errorMessage = 'Could not reach the server. Check your connection and try again.';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Exposure Tracking Map — US Superfund sites near an address</title>
  <meta
    name="description"
    content="Find EPA National Priorities List Superfund sites near any US address, with contaminants of concern and human-exposure status."
  />
</svelte:head>

<div class="flex h-screen flex-col bg-stone-50 text-stone-900">
  <header class="flex flex-wrap items-center gap-4 border-b border-stone-200 bg-white px-4 py-3">
    <h1 class="text-[15px] font-semibold tracking-tight">Exposure Tracking Map</h1>
    <div class="flex-1">
      <AddressSearch bind:address bind:radiusMiles {loading} onSubmit={search} />
    </div>
  </header>

  <main class="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
    <div class="h-1/2 md:h-auto md:w-80 md:shrink-0">
      <ResultsList
        {response}
        {loading}
        {errorMessage}
        {selectedEpaId}
        onSelect={(id) => (selectedEpaId = id)}
      />
    </div>
    <div class="min-h-0 flex-1">
      <Map
        {features}
        {radiusMiles}
        {selectedEpaId}
        searchPoint={response?.point ?? null}
        onSelect={(id) => (selectedEpaId = id)}
      />
    </div>
  </main>
</div>
