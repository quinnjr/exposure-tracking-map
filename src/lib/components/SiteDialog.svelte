<!-- src/lib/components/SiteDialog.svelte -->
<script lang="ts">
  import type { SiteDetail } from '$lib/types';
  import { exposureColor } from '$lib/statusColors';

  type Props = {
    epaId: string | null;
    distanceMiles?: number | null;
    onClose: () => void;
  };

  let { epaId, distanceMiles = null, onClose }: Props = $props();

  let dialog: HTMLDialogElement;
  let detail = $state<SiteDetail | null>(null);
  let loading = $state(false);
  let failed = $state(false);

  $effect(() => {
    if (!epaId) {
      if (dialog?.open) dialog.close();
      detail = null;
      failed = false;
      return;
    }

    loading = true;
    failed = false;
    detail = null;
    if (!dialog.open) dialog.showModal();

    let isCancelled = false;
    fetch(`/api/sites/${encodeURIComponent(epaId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: SiteDetail) => {
        if (!isCancelled) detail = body;
      })
      .catch(() => {
        if (!isCancelled) failed = true;
      })
      .finally(() => {
        if (!isCancelled) loading = false;
      });

    return () => {
      isCancelled = true;
    };
  });

  const MEASURES = [
    { key: 'humanExposureStatus', label: 'Human exposure under control' },
    { key: 'groundwaterMigrationStatus', label: 'Groundwater migration under control' },
    { key: 'constructionComplete', label: 'Construction complete' },
    { key: 'sitewideReadyForUse', label: 'Sitewide ready for anticipated use' }
  ] as const;
</script>

<dialog
  bind:this={dialog}
  onclose={onClose}
  data-testid="site-dialog"
  class="w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-stone-300 p-0 backdrop:bg-slate-900/40"
>
  {#if loading}
    <p class="p-6 text-[13px] text-stone-500">Loading site details…</p>
  {:else if failed}
    <div class="p-6">
      <p class="text-[13px] font-semibold text-slate-900">
        ⚠ Could not load details for this site.
      </p>
      <button type="button" onclick={() => dialog.close()} class="mt-4 text-[13px] underline">
        Close
      </button>
    </div>
  {:else if detail}
    <header class="flex items-start gap-3 border-b border-stone-200 px-6 py-4">
      <span
        class="mt-1.5 inline-block size-3.5 shrink-0 rounded-full border border-black/20"
        style:background-color={exposureColor(detail.humanExposureStatus)}
      ></span>
      <div class="min-w-0 flex-1">
        <h2 class="text-[15px] font-semibold leading-snug">{detail.name}</h2>
        <p class="mt-0.5 text-[12px] text-stone-500">
          {detail.nplStatusName}
          {#if detail.federalFacility}· Federal facility{/if}
          {#if distanceMiles !== null}· {distanceMiles} mi away{/if}
        </p>
      </div>
      <button
        type="button"
        onclick={() => dialog.close()}
        aria-label="Close site details"
        class="shrink-0 rounded px-2 py-1 text-stone-500 hover:bg-stone-100"
      >
        ✕
      </button>
    </header>

    <div class="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-4 text-[13px]">
      <section>
        <h3 class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Location
        </h3>
        <p class="text-stone-700">
          {#if detail.streetAddress}{detail.streetAddress}<br />{/if}
          {detail.city ? `${detail.city}, ` : ''}{detail.state}{detail.zip ? ` ${detail.zip}` : ''}
          {#if detail.county}<br />{detail.county} County{/if}
        </p>
        <p class="mt-1 text-[12px] text-stone-500">
          EPA ID {detail.epaId}{detail.epaRegion ? ` · Region ${detail.epaRegion}` : ''}
        </p>
      </section>

      <section>
        <h3 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Performance measures
        </h3>
        <dl class="divide-y divide-stone-100">
          {#each MEASURES as measure (measure.key)}
            <div class="flex items-baseline justify-between gap-4 py-1.5">
              <dt class="text-stone-600">{measure.label}</dt>
              <dd class="shrink-0 font-medium text-stone-900">
                {detail[measure.key] ?? 'Not reported'}
              </dd>
            </div>
          {/each}
        </dl>
      </section>

      <section>
        <h3 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Contaminants of concern
        </h3>
        {#if detail.contaminantsByMedium.length === 0}
          <p class="text-stone-500">No contaminant data reported for this site.</p>
        {:else}
          <div class="space-y-2" data-testid="contaminants">
            {#each detail.contaminantsByMedium as group (group.medium)}
              <div>
                <p class="font-medium text-stone-800">{group.medium}</p>
                <p class="text-stone-600">{group.contaminants.join(', ')}</p>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <!-- An external EPA URL, not an internal route, so resolve() does not apply. -->
      <a
        href={detail.profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-block text-[13px] font-medium text-slate-900 underline"
      >
        View EPA site profile ↗
      </a>
    </div>
  {/if}
</dialog>
