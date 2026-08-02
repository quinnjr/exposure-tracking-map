import { defineConfig } from '@playwright/test';

const DATABASE_URL = 'file:./e2e.db';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,

  // Retries only in CI. These specs drive a real production build behind a
  // preview server on a shared runner, and one of them still calls the live
  // Census geocoder, so a failure there is not always a regression. Locally,
  // retries would hide genuine flakiness, so there are none.
  retries: process.env.CI ? 2 : 0,

  // Fail the run if someone commits `test.only`.
  forbidOnly: !!process.env.CI,

  use: {
    baseURL: 'http://localhost:4173',
    // A retry that passes still records why the first attempt failed, so an
    // intermittent failure can be diagnosed rather than just absorbed.
    trace: 'on-first-retry'
  },
  webServer: {
    command:
      'pnpm exec prisma migrate deploy && pnpm exec prisma generate && pnpm exec tsx tests/seed-fixture.ts && pnpm build && pnpm preview --port 4173',
    port: 4173,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { DATABASE_URL }
  }
});
