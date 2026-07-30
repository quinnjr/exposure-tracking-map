<!-- src/lib/components/AddressSearch.svelte -->
<script lang="ts">
  import { RADIUS_OPTIONS } from '$lib/radius';

  type Props = {
    address: string;
    radiusMiles: number;
    loading?: boolean;
    onSubmit: (address: string, radiusMiles: number) => void;
  };

  let { address = $bindable(), radiusMiles = $bindable(), loading = false, onSubmit }: Props =
    $props();

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (address.trim() === '') return;
    onSubmit(address, radiusMiles);
  }
</script>

<form onsubmit={submit} class="flex flex-wrap items-center gap-2">
  <label class="sr-only" for="address">Street address, city, and state</label>
  <input
    id="address"
    name="address"
    type="text"
    autocomplete="street-address"
    placeholder="1600 Pennsylvania Ave NW, Washington, DC"
    bind:value={address}
    class="min-w-64 flex-1 rounded-md border border-stone-300 px-3 py-2 text-[15px] outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
  />

  <label class="sr-only" for="radius">Search radius in miles</label>
  <select
    id="radius"
    bind:value={radiusMiles}
    class="rounded-md border border-stone-300 bg-white px-2 py-2 text-[15px] outline-none focus:border-slate-900"
  >
    {#each RADIUS_OPTIONS as option (option)}
      <option value={option}>{option} mi</option>
    {/each}
  </select>

  <button
    type="submit"
    disabled={loading || address.trim() === ''}
    class="rounded-md bg-slate-900 px-4 py-2 text-[15px] font-medium text-white disabled:opacity-40"
  >
    {loading ? 'Searching…' : 'Search'}
  </button>
</form>
