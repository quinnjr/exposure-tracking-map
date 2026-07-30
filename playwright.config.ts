import { defineConfig } from '@playwright/test';

const DATABASE_URL = 'file:./e2e.db';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command:
      'pnpm exec prisma migrate deploy && pnpm exec prisma generate && pnpm exec tsx tests/seed-fixture.ts && pnpm build && pnpm preview --port 4173',
    port: 4173,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { DATABASE_URL }
  }
});
