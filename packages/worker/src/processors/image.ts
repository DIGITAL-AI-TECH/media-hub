import { Job } from 'bullmq';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import {
  ProcessingJob, ProcessedUrls,
  getPool, updateFileStatus,
  buildS3Key, buildCdnUrl, uploadFileToS3, downloadFromS3
} from '@media-hub/shared';

const THUMBNAILS = [
  { label: 'thumb_320', width: 320 },
  { label: 'thumb_720', width: 720 },
];

export async function imageProcessor(job: Job<ProcessingJob>): Promise<void> {
  const { fileId, uploadId, tenantSlug, s3KeyRaw } = job.data;
  const pool = getPool();
  const tmpDir = `/tmp/media-hub-${fileId}`;

  try {
    await fs.mkdir(tmpDir, { recursive: true });
    await updateFileStatus(pool, fileId, 'processing');

    const ext = s3KeyRaw.split('.').pop() || 'jpg';
    const localRaw = path.join(tmpDir, `raw.${ext}`);
    const s3Stream = await downloadFromS3(s3KeyRaw);
    await pipeline(s3Stream, createWriteStream(localRaw));

    const s3BaseKey = buildS3Key(tenantSlug, 'processed', uploadId, fileId, 'image');
    const processedUrls: ProcessedUrls = {};

    // Original as WebP
    const origLocal = path.join(tmpDir, 'original.webp');
    await sharp(localRaw).webp({ quality: 85 }).toFile(origLocal);
    const origS3Key = `${s3BaseKey}/original.webp`;
    await uploadFileToS3(origLocal, origS3Key, 'image/webp');
    processedUrls.original = buildCdnUrl(origS3Key);

    // Thumbnails
    const { width: origWidth } = await sharp(localRaw).metadata();
    for (const thumb of THUMBNAILS) {
      if (!origWidth || origWidth >= thumb.width) {
        const localThumb = path.join(tmpDir, `${thumb.label}.webp`);
        await sharp(localRaw)
          .resize({ width: thumb.width, withoutEnlargement: true })
          .webp({ quality: 85 })
          .toFile(localThumb);
        const thumbS3Key = `${s3BaseKey}/${thumb.label}.webp`;
        await uploadFileToS3(localThumb, thumbS3Key, 'image/webp');
        (processedUrls as Record<string, string>)[thumb.label] = buildCdnUrl(thumbS3Key);
      }
    }

    await updateFileStatus(pool, fileId, 'done', { processedUrls, s3KeyProcessed: s3BaseKey });

  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
