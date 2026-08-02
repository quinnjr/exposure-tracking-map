import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import svelteConfig from './svelte.config.js';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  unicorn.configs.recommended,
  ...svelte.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      // The reason this config exists. Every class member carries an explicit
      // accessibility modifier — `public` included, not just the non-default
      // ones — so a member's visibility is never inferred from its absence.
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'explicit' }
      ]
    }
  },

  {
    // Without this the .svelte files fail to parse entirely ("Unexpected token
    // Props") and are silently not linted — svelte-eslint-parser handles the
    // markup, but the <script lang="ts"> blocks need the TS parser nested
    // inside it. A config that skips five components is worse than no config,
    // because the report looks clean.
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte'],
        svelteConfig
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Unicorn rules switched off deliberately. Each of these fights a convention
  // this project already applies consistently; churning ~60 files to satisfy a
  // linter's default taste would create noise, not correctness.
  // ---------------------------------------------------------------------------
  {
    rules: {
      // The repo uses camelCase module names throughout (parseMeasures.ts,
      // statusColors.ts, seed-fixture.ts). SvelteKit additionally mandates
      // names this rule rejects outright: +page.svelte, +server.ts, [epaId].
      'unicorn/filename-case': 'off',

      // Domain vocabulary here is abbreviated by nature and matches EPA's own
      // field names: epaId, semsSiteId, npl, env, params, props, db.
      'unicorn/prevent-abbreviations': 'off',

      // Same family, and the cure is worse than the disease: this rule wants
      // `args` renamed to `arguments_` and `dir` to `directory`. A trailing
      // underscore to dodge a reserved word is not an improvement. 65 of the
      // 172 initial errors were this one rule.
      'unicorn/name-replacements': 'off',

      // `null` is load-bearing in this codebase rather than incidental: Prisma
      // returns null for absent columns, and "not reported" is a real domain
      // state distinct from undefined. Collapsing the two would lose meaning.
      'unicorn/no-null': 'off',

      // Node's process.exitCode is set deliberately in the download CLI so a
      // partial-source failure surfaces to the shell without throwing.
      'unicorn/no-process-exit': 'off',

      // Incompatible with two patterns this project uses pervasively and
      // correctly: Svelte 5 runes (`let x = $state()` at module scope, assigned
      // inside onMount/$effect — that IS the reactivity model), and Vitest
      // lifecycle setup (`let db` assigned in beforeAll). 44 hits, none a bug.
      'unicorn/no-top-level-assignment-in-function': 'off',

      // Autofixes to `error_` whenever `error` is already bound — which it is
      // in every SvelteKit route, since `error` is imported from @sveltejs/kit.
      // It also renamed a descriptive `auditErr` to `error_`, losing meaning.
      // A trailing underscore is not a better name than the one it replaced.
      'unicorn/catch-error-name': 'off',

      // Wants `import path from 'node:path'`. Named imports from node: builtins
      // are the modern convention and what this codebase uses throughout.
      'unicorn/import-style': 'off',

      // The remaining `.then()`/`.catch()` sites are ones where await is not
      // available: Svelte `$effect` callbacks are synchronous by contract, and
      // the download CLI's `main().catch()` is its top-level error boundary.
      'unicorn/prefer-await': 'off',
      'unicorn/prefer-top-level-await': 'off',

      // Wants `.toSorted()`. Every `.sort()` here is applied to a fresh array
      // from a spread or `.map()`, so nothing shared is being mutated; the
      // copy the rule asks for is the copy the code already made.
      'unicorn/no-array-sort': 'off',

      // Stylistic ordering and shape preferences with no correctness content.
      'unicorn/no-declarations-before-early-exit': 'off',
      'unicorn/no-break-in-nested-loop': 'off',
      'unicorn/no-await-expression-member': 'off',
      'unicorn/prefer-iterator-to-array': 'off',
      'unicorn/no-nested-ternary': 'off',
      'unicorn/prefer-minimal-ternary': 'off',
      'unicorn/max-nested-calls': 'off',

      // Guards against `.map(parseInt)` picking up the index argument. The
      // callbacks passed by reference here are all single-parameter, so the
      // hazard cannot arise, and naming them inline would only add noise.
      'unicorn/no-array-callback-reference': 'off',

      // Test helpers like `insideBox` read as predicates already; an `is`
      // prefix mandate is taste, and this codebase does not follow it.
      'unicorn/consistent-boolean-name': 'off',

      // The only <a href> in the app points at an external EPA site profile,
      // which resolve() does not apply to. Scoped off for links rather than
      // switched off wholesale, so the goto/pushState checks — the ones that
      // would catch a genuinely unresolved internal route — stay active.
      'svelte/no-navigation-without-resolve': ['error', { ignoreLinks: true }]
    }
  },

  {
    ignores: [
      '.svelte-kit/',
      'build/',
      'node_modules/',
      '.cache*/',
      'playwright-report/',
      'test-results/',
      // Session scratch, not project source.
      '.remember/',
      // Captured EPA HTML used as test fixtures — not authored source.
      'src/lib/server/ingest/fixtures/'
    ]
  }
);
