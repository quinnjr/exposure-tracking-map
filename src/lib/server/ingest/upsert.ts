import type { PrismaClient } from '@prisma/client';
import type { ContaminantRecord, SiteRecord } from './normalize';
import type { MeasureMap } from './parseMeasures';

/**
 * Insert or update sites keyed on semsSiteId. Only fields owned by the
 * Envirofacts sites feed are written, so a re-run never clobbers the
 * performance measures written by the scrape.
 */
export async function upsertSites(
  prisma: PrismaClient,
  records: SiteRecord[]
): Promise<number> {
  if (records.length === 0) return 0;

  let count = 0;
  for (let i = 0; i < records.length; i += WRITE_BATCH_SIZE) {
    const batch = records.slice(i, i + WRITE_BATCH_SIZE);
    await prisma.$transaction(
      async (tx) => {
        for (const r of batch) {
          await tx.site.upsert({
            where: { semsSiteId: r.semsSiteId },
            create: r,
            update: r
          });
          count += 1;
        }
      },
      { timeout: 120_000 }
    );
  }
  return count;
}

export type IngestOutcome<T> = { upserted: number; rejected: number; value: T };

/**
 * How long an IngestRun may sit at `running` before the next run for the same
 * source treats it as abandoned. This MUST exceed the longest legitimate run:
 * a full measures pass is ~2 hours (1,840 sites at ~3.75 s each), so a shorter
 * threshold would reconcile a healthy in-progress run to `failed`.
 */
export const STALE_RUN_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 hours

/**
 * Mark any `running` IngestRun for `source` older than STALE_RUN_THRESHOLD_MS
 * as `failed`. Called at the start of every `withIngestRun` so an orphaned
 * row (left behind when a previous run crashed hard enough that even the
 * catch-block audit write failed) doesn't sit as `running` forever.
 */
async function reconcileStaleRuns(prisma: PrismaClient, source: string): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_RUN_THRESHOLD_MS);
  await prisma.ingestRun.updateMany({
    where: { source, status: 'running', startedAt: { lt: staleBefore } },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      error: `Reconciled as abandoned: still 'running' after more than ${STALE_RUN_THRESHOLD_MS / 60_000} minutes.`
    }
  });
}

/**
 * Wrap one ingest source in an IngestRun audit row. A thrown error is
 * recorded and rethrown, so a failing source marks only its own run failed
 * and leaves data from other sources intact.
 */
export async function withIngestRun<T>(
  prisma: PrismaClient,
  source: string,
  fn: () => Promise<IngestOutcome<T>>
): Promise<T> {
  await reconcileStaleRuns(prisma, source);

  const run = await prisma.ingestRun.create({ data: { source, status: 'running' } });
  try {
    const { upserted, rejected, value } = await fn();
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        status: 'success',
        finishedAt: new Date(),
        recordsUpserted: upserted,
        recordsRejected: rejected
      }
    });
    return value;
  } catch (error) {
    try {
      await prisma.ingestRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
        }
      });
    } catch (auditError) {
      console.error(`[ingest] could not record failure for run ${run.id}:`, auditError);
    }
    throw error; // always rethrow the ORIGINAL error
  }
}

// SQLite auto-commits (and fsyncs) each statement outside an explicit
// transaction. An earlier unbatched version of this loop hit a Prisma P1008
// SocketTimeout at 56,552 rows because every upsert was its own commit.
// Batching writes inside `$transaction` collapses each batch to one commit.
const WRITE_BATCH_SIZE = 2000;

/**
 * Link contaminants to sites. Resolves site and contaminant ids up front so
 * the write loop performs no per-row lookups.
 */
export async function upsertContaminants(
  prisma: PrismaClient,
  records: ContaminantRecord[]
): Promise<number> {
  if (records.length === 0) return 0;

  const sites = await prisma.site.findMany({ select: { id: true, semsSiteId: true } });
  const siteIdBySems = new Map(sites.map((s) => [s.semsSiteId, s.id]));

  const names = [...new Set(records.map((r) => r.name))];
  for (let i = 0; i < names.length; i += WRITE_BATCH_SIZE) {
    const batch = names.slice(i, i + WRITE_BATCH_SIZE);
    await prisma.$transaction(
      async (tx) => {
        for (const name of batch) {
          await tx.contaminant.upsert({ where: { name }, create: { name }, update: {} });
        }
      },
      { timeout: 120_000 }
    );
  }
  const contaminants = await prisma.contaminant.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true }
  });
  const contaminantIdByName = new Map(contaminants.map((c) => [c.name, c.id]));

  let count = 0;
  for (let i = 0; i < records.length; i += WRITE_BATCH_SIZE) {
    const batch = records.slice(i, i + WRITE_BATCH_SIZE);
    await prisma.$transaction(
      async (tx) => {
        for (const r of batch) {
          const siteId = siteIdBySems.get(r.semsSiteId);
          const contaminantId = contaminantIdByName.get(r.name);
          if (siteId === undefined || contaminantId === undefined) {
            throw new Error(
              `Invariant violated: contaminant link references unknown ` +
                `${siteId === undefined ? `site ${r.semsSiteId}` : `contaminant ${r.name}`}. ` +
                `Records must be normalized against ingested sites before upserting.`
            );
          }

          await tx.siteContaminant.upsert({
            where: { siteId_contaminantId_media: { siteId, contaminantId, media: r.media } },
            create: { siteId, contaminantId, media: r.media },
            update: {}
          });
          count += 1;
        }
      },
      { timeout: 120_000 }
    );
  }
  return count;
}

/**
 * Write one site's performance measures, stamping when they were fetched.
 * Writes ONLY the four measure fields plus measuresFetchedAt — never site
 * identity or coordinates, which upsertSites deliberately cannot overwrite
 * from its side either.
 */
export async function upsertMeasures(
  prisma: PrismaClient,
  semsSiteId: string,
  measures: MeasureMap
): Promise<void> {
  await prisma.site.update({
    where: { semsSiteId },
    data: { ...measures, measuresFetchedAt: new Date() }
  });
}
