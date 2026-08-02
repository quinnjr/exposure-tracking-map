<!-- src/lib/components/AddressSearch.svelte -->
<script lang="ts">
  import { type AddressParts, composeAddress, isSubmittable, US_STATES } from '$lib/address';
  import { RADIUS_OPTIONS } from '$lib/radius';

  type Props = {
    parts: AddressParts;
    radiusMiles: number;
    loading?: boolean;
    onSubmit: (address: string, radiusMiles: number) => void;
  };

  let { parts = $bindable(), radiusMiles = $bindable(), loading = false, onSubmit }: Props =
    $props();

  let canSubmit = $derived(isSubmittable(parts));

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(composeAddress(parts), radiusMiles);
  }

  const field =
    'w-full rounded-md border border-stone-300 px-3 py-2 text-[15px] outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900';
  const labelClass = 'mb-1 block text-[12px] font-medium text-stone-600';
</script>

<form onsubmit={submit} class="flex flex-col gap-3">
  <div>
    <label class={labelClass} for="line1">Address line 1</label>
    <input
      id="line1"
      name="line1"
      type="text"
      autocomplete="address-line1"
      placeholder="1600 Pennsylvania Avenue NW"
      bind:value={parts.line1}
      class={field}
    />
  </div>

  <div>
    <label class={labelClass} for="line2">Address line 2</label>
    <input
      id="line2"
      name="line2"
      type="text"
      autocomplete="address-line2"
      placeholder="Apt, suite, unit (optional)"
      bind:value={parts.line2}
      class={field}
    />
  </div>

  <div>
    <label class={labelClass} for="city">City</label>
    <input
      id="city"
      name="city"
      type="text"
      autocomplete="address-level2"
      placeholder="Washington"
      bind:value={parts.city}
      class={field}
    />
  </div>

  <div class="flex gap-2">
    <div class="w-24 shrink-0">
      <label class={labelClass} for="state">State</label>
      <select
        id="state"
        name="state"
        autocomplete="address-level1"
        bind:value={parts.state}
        class="{field} bg-white"
      >
        <option value="">—</option>
        {#each US_STATES as code (code)}
          <option value={code}>{code}</option>
        {/each}
      </select>
    </div>
    <div class="flex-1">
      <label class={labelClass} for="zip">ZIP code</label>
      <input
        id="zip"
        name="zip"
        type="text"
        inputmode="numeric"
        autocomplete="postal-code"
        placeholder="20500"
        maxlength="10"
        bind:value={parts.zip}
        class={field}
      />
    </div>
  </div>

  <div>
    <label class={labelClass} for="radius">Search radius in miles</label>
    <select id="radius" bind:value={radiusMiles} class="{field} bg-white">
      {#each RADIUS_OPTIONS as option (option)}
        <option value={option}>{option} miles</option>
      {/each}
    </select>
  </div>

  <button
    type="submit"
    disabled={loading || !canSubmit}
    class="rounded-md bg-slate-900 px-4 py-2 text-[15px] font-medium text-white disabled:opacity-40"
  >
    {loading ? 'Searching…' : 'Search'}
  </button>

  <!-- Stated up front rather than only after a failed lookup: the one-line
       geocoder cannot match a city and state without a street address. -->
  {#if !canSubmit}
    <p class="text-[12px] text-stone-500">
      Enter a street address plus either a ZIP code or a city and state.
    </p>
  {/if}
</form>
