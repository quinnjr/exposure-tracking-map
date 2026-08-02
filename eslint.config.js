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

  // `unopinionated`, not `recommended`. Both ship the same 300-odd rules; the
  // difference is that `recommended` also enables unicorn's taste layer —
  // naming mandates, null bans, ternary shape. Measured against this codebase,
  // 13 of the rules we would otherwise have to disable by hand are already off
  // here, so the exception list below shrinks to genuine disagreements. It also
  // means the next unicorn major lands new taste rules OFF rather than dumping
  // a fresh wall of errors into `pnpm lint`.
  unicorn.configs.unopinionated,

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

  {
    rules: {
      // Scoped to the one module we have a position on. The rule's default
      // wants `import path from 'node:path'`; we use named imports from
      // `node:path` throughout. Switching the whole rule off would also stop
      // it checking `node:util`, `node:os`, and namespace-import style, which
      // this project has never taken a view on either way.
      'unicorn/import-style': ['error', { styles: { path: { named: true } } }],

      // Wants `.toSorted()`. Verified each of the 6 call sites: every one
      // sorts a fresh array from a spread or `.map()`, so nothing shared is
      // mutated and the copy the rule asks for is the copy already made.
      'unicorn/no-array-sort': 'off',

      // Shape and ordering preferences with no correctness content. Grouped
      // rather than argued individually because the argument is the same for
      // each: they describe a house style this codebase does not hold.
      'unicorn/no-declarations-before-early-exit': 'off',
      'unicorn/prefer-minimal-ternary': 'off',

      // Left ON with links checked, rather than the blanket `ignoreLinks: true`
      // this started as. See the SiteDialog carve-out below for the one
      // exception; every other component still gets the check.
      'svelte/no-navigation-without-resolve': ['error', { ignoreLinks: false }]
    }
  },

  {
    // The one `<a href>` in the app, pointing at an external EPA site profile.
    // `profileUrl` is built from a hardcoded `https://cumulis.epa.gov/...` base
    // with scraped data landing only after the `?`, so it cannot carry a scheme
    // and resolve() does not apply to it.
    //
    // Scoped to the file rather than switched off repo-wide, because the rule's
    // real value is the INTERNAL link nobody has written yet: an unresolved
    // internal href breaks only under a non-root `base` path, which never shows
    // up in `pnpm dev`. An inline disable would be tighter still, but the rule
    // reports on the `href` attribute line and no comment can sit between `<a`
    // and its attributes without reformatting the markup.
    files: ['src/lib/components/SiteDialog.svelte'],
    rules: { 'svelte/no-navigation-without-resolve': 'off' }
  },

  {
    // Configured rather than disabled, so the conventions the repo already
    // follows are enforced going forward instead of resting on habit. Note
    // `+page.svelte` and `+server.ts` are unaffected either way — the rule
    // strips leading non-alphanumerics before checking. The ignore pattern
    // covers SvelteKit's `[epaId]` route directory, the one name the framework
    // genuinely dictates.
    //
    // Application code: camelCase modules (parseMeasures.ts, statusColors.ts),
    // PascalCase components (SiteDialog.svelte).
    files: ['src/**', 'scripts/**'],
    rules: {
      'unicorn/filename-case': [
        'error',
        { cases: { camelCase: true, pascalCase: true }, ignore: [/^\[.+]$/] }
      ]
    }
  },

  {
    // Test scaffolding is kebab-case (seed-fixture.ts, prisma-test-client.ts,
    // map-failure.spec.ts). A different tree with a different established
    // convention — enforced separately rather than papered over by allowing
    // every case everywhere, which would enforce nothing.
    files: ['tests/**'],
    rules: { 'unicorn/filename-case': ['error', { case: 'kebabCase' }] }
  },

  {
    // `scripts/` is a CLI. `process.exit(1)` in its top-level `main().catch()`
    // is the rule's own carve-out for CLI apps, which it cannot detect; the
    // exit must be forced even with pending handles. Scoped here so an
    // abrupt exit added to a server route or ingest module is still reported.
    files: ['scripts/**'],
    rules: { 'unicorn/no-process-exit': 'off' }
  },

  {
    // Promise chains that cannot become `await`: Svelte `$effect` callbacks are
    // synchronous by contract, and the download CLI's `main().catch()` is its
    // top-level error boundary. Everywhere else — including test setup, where
    // an unawaited `$disconnect()` is exactly the bug this rule catches — the
    // rule stays on.
    files: ['**/*.svelte', 'scripts/**'],
    rules: {
      'unicorn/prefer-await': 'off',
      'unicorn/prefer-top-level-await': 'off'
    }
  },

  {
    // In tests asserting whitespace handling, the literal IS the fixture.
    // `' '.repeat(3)` makes the reader evaluate an expression to learn what the
    // input is, and implies the count matters when any whitespace run would do.
    files: ['**/*.test.ts', 'tests/**'],
    rules: { 'unicorn/prefer-string-repeat': 'off' }
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
