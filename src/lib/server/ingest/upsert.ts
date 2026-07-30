import type { PrismaClient } from '@prisma/client';
import type { ContaminantRecord, SiteRecord } from './normalize';

/**
 * Insert or update sites keyed on semsSiteId. Only fields owned by the
 * Envirofacts sites feed are written, so a re-run never clobbers the
 * performance measures written by the scrape.
 */
export async function upsertSites(
  prisma: PrismaClient,
  records: SiteRecord[]
): Promise<number> {
  let count = 0;
  for (const r of records) {
    await prisma.site.upsert({
      where: { semsSiteId: r.semsSiteId },
      create: r,
      update: r
    });
    count += 1;
  }
  return count;
}

export type IngestOutcome<T> = { upserted: number; rejected: number; value: T };

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
  } catch (err) {
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
      }
    });
    throw err;
  }
}

/**
 * Link contaminants to sites. Resolves site and contaminant ids up front so
 * the write loop performs no per-row lookups.
 */
/**
 * SQLite auto-commits (and fsyncs) each statement outside an explicit
 * transaction, so issuing tens of thousands of individual upserts is
 * prohibitively slow. Batching writes inside `$transaction` collapses each
 * batch to a single commit.
 */
const WRITE_BATCH_SIZE = 2000;

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
          if (siteId === undefined || contaminantId === undefined) continue;

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
