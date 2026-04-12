import { Job } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import {
  ProcessingJob, ProcessedUrls,
  getPool, updateFileStatus,
  buildS3Key, buildCdnUrl, uploadFileToS3, downloadFromS3
} from '@media-hub/shared';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT_RE  = /^[a-zA-Z0-9]{1,10}$/;

export async function audioProcessor(job: Job<ProcessingJob>): Promise<void> {
  const { fileId, uploadId, tenantId, tenantSlug, s3KeyRaw } = job.data;
  const pool = getPool();

  if (!UUID_RE.test(fileId)) throw new Error(`Invalid fileId format: ${fileId}`);

  const tmpDir = `/tmp/media-hub-${fileId}`;

  try {
    await fs.mkdir(tmpDir, { recursive: true });
    await updateFileStatus(pool, fileId, 'processing', { tenantId });

    const rawExt = s3KeyRaw.split('.').pop() ?? 'mp3';
    const ext = EXT_RE.test(rawExt) ? rawExt : 'mp3';
    const localRaw = path.join(tmpDir, `raw.${ext}`);
    const s3Stream = await downloadFromS3(s3KeyRaw);
    await pipeline(s3Stream, createWriteStream(localRaw));

    const localMp3 = path.join(tmpDir, 'audio.mp3');

    await new Promise<void>((resolve, reject) => {
      ffmpeg(localRaw)
        .audioCodec('libmp3lame')
        .audioBitrate(192)
        .audioFilters('loudnorm')
        .output(localMp3)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });

    const s3BaseKey = buildS3Key(tenantSlug, 'processed', uploadId, fileId, 'audio');
    const mp3S3Key = `${s3BaseKey}/audio.mp3`;
    await uploadFileToS3(localMp3, mp3S3Key, 'audio/mpeg');

    const processedUrls: ProcessedUrls = { mp3: buildCdnUrl(mp3S3Key) };
    await updateFileStatus(pool, fileId, 'done', { processedUrls, s3KeyProcessed: s3BaseKey, tenantId });

  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
