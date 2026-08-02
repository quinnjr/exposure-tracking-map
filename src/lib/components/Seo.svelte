<!-- src/lib/components/Seo.svelte -->
<script lang="ts">
  import { SITE_NAME, type SeoMeta } from '$lib/seo';

  let { title, description, canonical, jsonLd = [], robots }: SeoMeta = $props();

  /**
   * Serialised here rather than inline in the markup. The inline version was a
   * template literal containing a `</script` guard, which is enough to defeat
   * the Svelte ESLint parser — the file failed to parse and was therefore not
   * linted at all, which is worse than any rule it might have broken.
   *
   * The guard itself is required: JSON encoding does not escape `</script`, so
   * a contaminant or site name containing it would close the tag early. Every
   * value here is server-derived from our own database, so this is defence in
   * depth rather than the last line of it.
   */
  const OPEN = '<script type="application/ld+json">';
  // Split deliberately: written as one literal, the closing tag would terminate
  // THIS component's <script> block, because the HTML parser scans for it
  // without understanding JavaScript string boundaries.
  // eslint-disable-next-line unicorn/no-useless-concat
  const CLOSE = '</' + 'script>';

  const blocks = $derived(
    jsonLd.map(
      (block) => OPEN + JSON.stringify(block).replaceAll('</script', String.raw`<\/script`) + CLOSE
    )
  );
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />

  <!-- Every page is reachable by more than one path once the map deep-links to
       it, so the canonical is stated explicitly rather than left to be guessed. -->
  <link rel="canonical" href={canonical} />
  {#if robots}
    <meta name="robots" content={robots} />
  {/if}

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content={SITE_NAME} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={canonical} />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description} />

  <!--
    One <script> per graph object rather than a single @graph array. Both are
    valid; separate blocks mean a malformed object is ignored on its own rather
    than invalidating every other statement on the page. Serialisation and its
    reasoning live in the script block above.
  -->
  {#each blocks as block, index (index)}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html block}
  {/each}
</svelte:head>
