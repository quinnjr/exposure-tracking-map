<!-- src/lib/components/ResultsList.svelte -->
<script lang="ts">
  import { exposureColor } from '$lib/statusColors';
  import type { SearchResponse } from '$lib/types';

  type Props = {
    response: SearchResponse | null;
    loading?: boolean;
    errorMessage?: string | null;
    selectedEpaId?: string | null;
    onSelect: (epaId: string) => void;
  };

  let { response, loading = false, errorMessage = null, selectedEpaId = null, onSelect }: Props =
    $props();

  let heading = $derived.by(() => {
    if (!response) return '';
    const n = response.results.length;
    if (response.outsideRadius) {
      return n === 0
        ? 'No Superfund sites found'
        : `Nothing within ${response.radiusMiles} miles — closest ${n === 1 ? 'site' : `${n} sites`}`;
    }
    return `${n} ${n === 1 ? 'site' : 'sites'} within ${response.radiusMiles} miles`;
  });
</script>

<section class="flex h-full flex-col border-r border-stone-200 bg-white">
  <div aria-live="polite" class="border-b border-stone-200 px-4 py-3">
    {#if loading}
      <p class="text-[13px] text-stone-500">Looking up that address…</p>
    {:else if errorMessage}
      <p class="text-[13px] font-semibold text-slate-900">⚠ {errorMessage}</p>
    {:else if response}
      <p class="text-[15px] font-semibold text-stone-900">{heading}</p>
      <p class="mt-0.5 text-[12px] text-stone-500">
        Straight-line distance from {response.point.matchedAddress}
      </p>
    {:else}
      <p class="text-[13px] text-stone-500">
        Enter an address to see the Superfund sites nearest to it.
      </p>
    {/if}
  </div>

  {#if response && response.results.length > 0}
    <ul class="flex-1 overflow-y-auto">
      {#each response.results as site (site.epaId)}
        <li>
          <button
            type="button"
            onclick={() => onSelect(site.epaId)}
            aria-current={selectedEpaId === site.epaId ? 'true' : undefined}
            data-testid="result-row"
            class="flex w-full items-start gap-3 border-b border-stone-100 px-4 py-3 text-left hover:bg-stone-50 focus:bg-stone-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-slate-900 aria-[current]:bg-stone-100"
          >
            <span
              class="mt-1 inline-block size-3 shrink-0 rounded-full border border-black/20"
              style:background-color={exposureColor(site.humanExposureStatus)}
            ></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13px] font-medium text-stone-900">{site.name}</span>
              <span class="block text-[12px] text-stone-500">
                {site.city ? `${site.city}, ` : ''}{site.state} · {site.nplStatusName}
              </span>
            </span>
            <span class="shrink-0 text-[13px] tabular-nums text-stone-600">
              {site.distanceMiles} mi
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
