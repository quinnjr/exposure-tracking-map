<!-- src/lib/components/Legend.svelte -->
<script lang="ts">
  import { EXPOSURE_LEGEND } from '$lib/statusColors';
</script>

<div
  class="pointer-events-none absolute bottom-3 right-3 rounded-md border border-stone-300 bg-white/95 p-3 shadow-sm"
>
  <p class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
    Human exposure
  </p>
  <ul class="space-y-1">
    {#each EXPOSURE_LEGEND as entry (entry.label)}
      <li class="flex items-center gap-2 text-[13px] text-stone-700">
        <span
          class="inline-block size-3 rounded-full border border-black/20"
          style:background-color={entry.color}
        ></span>
        {entry.label}
      </li>
    {/each}
  </ul>
  <p class="mt-2 max-w-44 text-[11px] leading-snug text-stone-500">
    Hollow ring = deleted from the NPL
  </p>
</div>
