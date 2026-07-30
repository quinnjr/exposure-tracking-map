import type { PrismaClient } from '@prisma/client';
import type { SiteRecord } from './normalize';

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
