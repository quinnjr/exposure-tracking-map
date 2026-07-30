import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type TestDatabase = {
  prisma: PrismaClient;
  url: string;
  cleanup: () => Promise<void>;
};

/** Fresh migrated SQLite database in a temp dir. Call cleanup() in afterAll. */
export function createTestDatabase(): TestDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'etm-test-'));
  const url = `file:${join(dir, 'test.db')}`;

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe'
  });

  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

  const cleanup = async () => {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  };

  return { prisma, url, cleanup };
}
