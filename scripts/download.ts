import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { normalizeSites } from '../src/lib/server/ingest/normalize';
import { fetchSiteRows } from '../src/lib/server/ingest/sources/sites';
import { upsertSites, withIngestRun } from '../src/lib/server/ingest/upsert';

type Args = {
  refresh: boolean;
  dryRun: boolean;
  sources: string[];
  limit: number | null;
};

const ALL_SOURCES = ['sites', 'contaminants', 'measures'] as const;

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

  const source = get('source');
  const limit = get('limit');

  if (source && !ALL_SOURCES.includes(source as (typeof ALL_SOURCES)[number])) {
    throw new Error(`--source must be one of ${ALL_SOURCES.join(', ')}`);
  }

  return {
    refresh: argv.includes('--refresh'),
    dryRun: argv.includes('--dry-run'),
    sources: source ? [source] : [...ALL_SOURCES],
    limit: limit ? Number(limit) : null
  };
}

async function ingestSites(prisma: PrismaClient, args: Args): Promise<void> {
  const rows = await fetchSiteRows({ refresh: args.refresh });
  const { records, rejected } = normalizeSites(rows);

  console.log(`[sites] fetched ${rows.length} rows -> ${records.length} valid, ${rejected.length} rejected`);
  for (const r of rejected) console.warn(`[sites] rejected ${r.semsSiteId}: ${r.reason}`);

  if (args.dryRun) {
    console.log('[sites] dry run — nothing written');
    return;
  }

  await withIngestRun(prisma, 'sites', async () => {
    const upserted = await upsertSites(prisma, records);
    console.log(`[sites] upserted ${upserted}`);
    return { upserted, rejected: rejected.length, value: undefined };
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL ?? 'file:./dev.db';
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  try {
    if (args.sources.includes('sites')) await ingestSites(prisma, args);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
