import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { env, getPool, updateFileStatus, ProcessingJob } from '@media-hub/shared';
import { videoProcessor } from './processors/video.js';
import { imageProcessor } from './processors/image.js';
import { audioProcessor } from './processors/audio.js';
import { genericProcessor } from './processors/generic.js';
import { checkAndNotifyUploadDone } from './services/webhook.js';

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const pool = getPool();

const worker = new Worker<ProcessingJob>(
  'media-processing',
  async (job: Job<ProcessingJob>) => {
    const { fileId, mediaType, uploadId, tenantId, tenantSlug } = job.data;
    console.log(`[worker] Processing job ${job.id}: file=${fileId} type=${mediaType}`);

    try {
      switch (mediaType) {
        case 'video':   await videoProcessor(job); break;
        case 'image':   await imageProcessor(job); break;
        case 'audio':   await audioProcessor(job); break;
        default:        await genericProcessor(job); break;
      }
    } catch (err) {
      try {
        await updateFileStatus(pool, fileId, 'failed', {
          errorMessage: err instanceof Error ? err.message : String(err),
          tenantId,
        });
      } catch (updateErr) {
        console.error(`[worker] Failed to update file status for ${fileId}:`, updateErr);
      }
      throw err;
    }

    // Fetch upload callback info — include tenant_id to enforce isolation
    const uploadResult = await pool.query(
      `SELECT callback_url, callback_secret, external_ref FROM uploads WHERE id = $1 AND tenant_id = $2`,
      [uploadId, tenantId]
    );
    const upload = uploadResult.rows[0];
    if (upload) {
      await checkAndNotifyUploadDone(
        uploadId, tenantSlug, upload.external_ref,
        upload.callback_url, upload.callback_secret
      );
    }
  },
  {
    connection: redis,
    concurrency: env.WORKER_CONCURRENCY,
    lockDuration: 300000, // 5 min — Gotcha G-008
  }
);

worker.on('completed', (job) => {
  console.log(`[worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err.message);
});

process.on('SIGTERM', async () => {
  await worker.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
});

console.log(`[worker] Started with concurrency=${env.WORKER_CONCURRENCY}`);
