import { Job } from 'bullmq';
import { ProcessingJob, ProcessedUrls, getPool, updateFileStatus, buildCdnUrl } from '@media-hub/shared';

export async function genericProcessor(job: Job<ProcessingJob>): Promise<void> {
  const { fileId, s3KeyRaw } = job.data;
  const pool = getPool();
  await updateFileStatus(pool, fileId, 'processing');
  const processedUrls: ProcessedUrls = { url: buildCdnUrl(s3KeyRaw) };
  await updateFileStatus(pool, fileId, 'done', { processedUrls, s3KeyProcessed: s3KeyRaw });
}
