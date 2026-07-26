import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { env, getPool, updateFileStatus, ProcessingJob } from '@media-hub/shared';
import { videoProcessor } from './processors/video.js';
import { imageProcessor } from './processors/image.js';
import { audioProcessor } from './processors/audio.js';
import { genericProcessor } from './processors/generic.js';
import { sendFileProcessedCallback, checkAndNotifyUploadDone } from './services/webhook.js';

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
    if (upload?.callback_url) {
      // Send per-file callback so the consumer can update the file status immediately.
      // Query processed_urls from the files table (set by the processor above).
      const fileResult = await pool.query(
        `SELECT processed_urls, media_type FROM files WHERE id = $1`,
        [fileId]
      );
      const fileData = fileResult.rows[0];
      if (fileData?.processed_urls) {
        try {
          await sendFileProcessedCallback(
            uploadId, fileId, tenantSlug, upload.external_ref,
            fileData.processed_urls, fileData.media_type,
            upload.callback_url, upload.callback_secret
          );
          console.log(`[worker] Webhook file.processed sent: file=${fileId} url=${upload.callback_url}`);
        } catch (cbErr) {
          // Log but do not fail the job — checkAndNotifyUploadDone still fires below.
          // IMPORTANT: this is the most common silent failure — if this fires, the
          // consumer (e.g. ifans) will NOT know the file is ready until it polls.
          const errMsg = cbErr instanceof Error ? cbErr.message : String(cbErr);
          console.error(`[worker] WEBHOOK FAILED file.processed file=${fileId} url=${upload.callback_url}: ${errMsg}`);
        }
      }
      // Then fire the upload-level event (upload.done) when all files are processed
      try {
        await checkAndNotifyUploadDone(
          uploadId, tenantSlug, upload.external_ref,
          upload.callback_url, upload.callback_secret
        );
      } catch (uploadCbErr) {
        const errMsg = uploadCbErr instanceof Error ? uploadCbErr.message : String(uploadCbErr);
        console.error(`[worker] WEBHOOK FAILED upload.done upload=${uploadId} url=${upload.callback_url}: ${errMsg}`);
      }
    }
  },
  {
    connection: redis,
    concurrency: env.WORKER_CONCURRENCY,
    lockDuration: 3600000, // 60 min — large videos (484MB+) take 20-40 min for HLS encoding
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
