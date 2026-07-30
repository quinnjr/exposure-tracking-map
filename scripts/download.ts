import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { normalizeContaminants, normalizeSites } from '../src/lib/server/ingest/normalize';
import { fetchContaminantRows } from '../src/lib/server/ingest/sources/contaminants';
import { fetchMeasures } from '../src/lib/server/ingest/sources/measures';
import { fetchSiteRows } from '../src/lib/server/ingest/sources/sites';
import {
  upsertContaminants,
  upsertMeasures,
  upsertSites,
  withIngestRun
} from '../src/lib/server/ingest/upsert';

type Args = {
  refresh: boolean;
  dryRun: boolean;
  sources: string[];
  limit: number | null;
};

const ALL_SOURCES = ['sites', 'contaminants', 'measures'] as const;

// Measured against the real scrape (fetch + parse + write per site,
// including EPA's response latency), not SCRAPE_DELAY_MS alone — the
// throttle delay understates the real per-site cost by roughly an order of
// magnitude. This is what makes the printed estimate agree with the
// README's ~2-hour figure instead of contradicting it.
const OBSERVED_SECONDS_PER_SITE = 3.75;

// A parsed page where every one of the four measure fields is null is
// ambiguous: it's either a site with no measures table (expected, benign),
// or EPA silently renamed a label and LABEL_TO_FIELD stopped matching
// (a scrape-wide silent failure). Warn loudly once the all-null rate for a
// run crosses this fraction of scraped sites.
const ALL_NULL_WARN_FRACTION = 0.25;

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

  const source = get('source');
  const limitRaw = get('limit');

  if (source && !ALL_SOURCES.includes(source as (typeof ALL_SOURCES)[number])) {
    throw new Error(`--source must be one of ${ALL_SOURCES.join(', ')}`);
  }

  let limit: number | null = null;
  if (limitRaw !== undefined) {
    limit = Number(limitRaw);
    if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
      throw new Error(`--limit must be a positive integer, got ${JSON.stringify(limitRaw)}`);
    }
  }

  return {
    refresh: argv.includes('--refresh'),
    dryRun: argv.includes('--dry-run'),
    sources: source ? [source] : [...ALL_SOURCES],
    limit
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

async function ingestContaminants(prisma: PrismaClient, args: Args): Promise<void> {
  const sites = await prisma.site.findMany({ select: { semsSiteId: true } });
  if (sites.length === 0) {
    throw new Error('No sites in the database — run `pnpm download --source=sites` first');
  }
  const known = new Set(sites.map((s) => s.semsSiteId));

  const rows = await fetchContaminantRows({ refresh: args.refresh });
  const { records, skipped } = normalizeContaminants(rows, known);
  console.log(
    `[contaminants] ${rows.length} rows -> ${records.length} triples for ${known.size} sites (${skipped} skipped as non-NPL or unnamed)`
  );

  if (args.dryRun) {
    console.log('[contaminants] dry run — nothing written');
    return;
  }

  await withIngestRun(prisma, 'contaminants', async () => {
    const upserted = await upsertContaminants(prisma, records);
    console.log(`[contaminants] upserted ${upserted} links`);
    return { upserted, rejected: skipped, value: undefined };
  });
}

async function ingestMeasures(prisma: PrismaClient, args: Args): Promise<void> {
  const all = await prisma.site.findMany({
    select: { semsSiteId: true },
    orderBy: { semsSiteId: 'asc' }
  });
  if (all.length === 0) {
    throw new Error('No sites in the database — run `pnpm download --source=sites` first');
  }

  const sites = args.limit ? all.slice(0, args.limit) : all;
  const estimateMinutes = Math.ceil((sites.length * OBSERVED_SECONDS_PER_SITE) / 60);
  console.log(
    `[measures] scraping ${sites.length} of ${all.length} sites (~${estimateMinutes} min)` +
      (args.limit ? ` — limited by --limit=${args.limit}` : '')
  );

  if (args.dryRun) {
    console.log('[measures] dry run — nothing fetched or written');
    return;
  }

  await withIngestRun(prisma, 'measures', async () => {
    let upserted = 0;
    let failed = 0;
    let allNull = 0;

    for (const [index, { semsSiteId }] of sites.entries()) {
      const measures = await fetchMeasures(semsSiteId, { refresh: args.refresh });
      if (measures === null) {
        failed += 1;
      } else {
        if (Object.values(measures).every((v) => v === null)) allNull += 1;
        await upsertMeasures(prisma, semsSiteId, measures);
        upserted += 1;
      }
      if ((index + 1) % 100 === 0) {
        console.log(`[measures] ${index + 1}/${sites.length} (${failed} failed, ${allNull} all-null)`);
      }
    }

    console.log(`[measures] upserted ${upserted}, failed ${failed}, all-null ${allNull}`);

    // An all-null parse (page fetched, but none of the four fields matched)
    // is a distinct failure mode from a fetch failure: it means the scrape
    // "succeeded" while silently recording every measure as unknown. A
    // handful is normal (some sites genuinely have no measures table); a
    // spike usually means EPA renamed a label and LABEL_TO_FIELD no longer
    // matches anything.
    if (sites.length > 0 && allNull / sites.length > ALL_NULL_WARN_FRACTION) {
      console.warn(
        `[measures] WARNING: ${allNull}/${sites.length} scraped sites (${Math.round(
          (allNull / sites.length) * 100
        )}%) parsed with ALL measures null — this exceeds the ${Math.round(
          ALL_NULL_WARN_FRACTION * 100
        )}% threshold and likely means EPA changed the page format (LABEL_TO_FIELD mismatch), not that this many sites genuinely lack measures.`
      );
    }

    return { upserted, rejected: failed, value: undefined };
  });
}

const SOURCE_INGESTORS: Record<string, (prisma: PrismaClient, args: Args) => Promise<void>> = {
  sites: ingestSites,
  contaminants: ingestContaminants,
  measures: ingestMeasures
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL ?? 'file:./dev.db';
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  const succeeded: string[] = [];
  const failed: string[] = [];
  try {
    for (const source of args.sources) {
      const ingest = SOURCE_INGESTORS[source];
      try {
        await ingest(prisma, args);
        succeeded.push(source);
      } catch (err) {
        failed.push(source);
        console.error(`[${source}] failed — continuing with remaining sources:`, err);
      }
    }

    console.log(
      `[download] summary: ${succeeded.length} succeeded (${succeeded.join(', ') || 'none'}), ` +
        `${failed.length} failed (${failed.join(', ') || 'none'})`
    );

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
