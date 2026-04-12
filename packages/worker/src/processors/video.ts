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

interface Resolution { label: string; height: number; bitrate: string; crf: number; preset: string; }

const RESOLUTIONS: Resolution[] = [
  { label: '360p',  height: 360,  bitrate: '800k',   crf: 23, preset: 'fast' },
  { label: '720p',  height: 720,  bitrate: '2500k',  crf: 23, preset: 'fast' },
  { label: '1080p', height: 1080, bitrate: '5000k',  crf: 23, preset: 'fast' },
  { label: '4k',    height: 2160, bitrate: '15000k', crf: 20, preset: 'slow' },
];

async function getVideoHeight(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      resolve(videoStream?.height || 1080);
    });
  });
}

async function generateHlsVariant(
  inputPath: string,
  outputDir: string,
  res: Resolution
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .addOption('-crf', String(res.crf))
      .addOption('-preset', res.preset)
      .addOption('-vf', `scale=-2:${res.height}`)
      .addOption('-hls_time', '6')
      .addOption('-hls_list_size', '0')
      .addOption('-hls_segment_filename', path.join(outputDir, `${res.label}_%03d.ts`))
      .addOption('-f', 'hls')
      .output(path.join(outputDir, `${res.label}.m3u8`))
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

async function generateThumbnail(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(1)
      .frames(1)
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

async function generateMasterPlaylist(
  outputDir: string,
  variants: { label: string; bitrate: string; height: number }[]
): Promise<string> {
  let master = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
  for (const v of variants) {
    const bandwidth = parseInt(v.bitrate) * 1000;
    master += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=x${v.height},NAME="${v.label}"\n`;
    master += `${v.label}.m3u8\n\n`;
  }
  const masterPath = path.join(outputDir, 'master.m3u8');
  await fs.writeFile(masterPath, master);
  return masterPath;
}

export async function videoProcessor(job: Job<ProcessingJob>): Promise<void> {
  const { fileId, uploadId, tenantSlug, s3KeyRaw } = job.data;
  const pool = getPool();
  const tmpDir = `/tmp/media-hub-${fileId}`;

  try {
    await fs.mkdir(tmpDir, { recursive: true });
    await updateFileStatus(pool, fileId, 'processing');

    // Download raw file
    const ext = s3KeyRaw.split('.').pop() || 'mp4';
    const localRaw = path.join(tmpDir, `raw.${ext}`);
    const s3Stream = await downloadFromS3(s3KeyRaw);
    await pipeline(s3Stream, createWriteStream(localRaw));

    // Detect original resolution
    const originalHeight = await getVideoHeight(localRaw);
    job.log(`Video height: ${originalHeight}px`);

    // Generate thumbnail
    const thumbLocal = path.join(tmpDir, 'thumb.webp');
    await generateThumbnail(localRaw, thumbLocal);

    // Determine which resolutions to generate (no upscale)
    const applicableResolutions = RESOLUTIONS.filter(r => r.height <= originalHeight);
    if (applicableResolutions.length === 0) applicableResolutions.push(RESOLUTIONS[0]);

    // Generate HLS for each resolution
    const processedUrls: ProcessedUrls = {};
    const s3BaseKey = buildS3Key(tenantSlug, 'processed', uploadId, fileId, 'video');

    for (const res of applicableResolutions) {
      const variantDir = path.join(tmpDir, res.label);
      await fs.mkdir(variantDir, { recursive: true });
      await generateHlsVariant(localRaw, variantDir, res);

      // Upload all .ts segments and .m3u8 for this variant
      const variantFiles = await fs.readdir(variantDir);
      for (const fname of variantFiles) {
        const localPath = path.join(variantDir, fname);
        const s3Key = `${s3BaseKey}/${res.label}/${fname}`;
        const ct = fname.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
        await uploadFileToS3(localPath, s3Key, ct);
      }

      const m3u8Key = `${s3BaseKey}/${res.label}/${res.label}.m3u8`;
      (processedUrls as Record<string, string>)[`hls_${res.label}`] = buildCdnUrl(m3u8Key);
    }

    // Generate and upload master.m3u8
    const masterPath = await generateMasterPlaylist(tmpDir, applicableResolutions.map(r => ({
      label: r.label, bitrate: r.bitrate, height: r.height
    })));
    const masterS3Key = `${s3BaseKey}/master.m3u8`;
    await uploadFileToS3(masterPath, masterS3Key, 'application/vnd.apple.mpegurl');
    processedUrls.hls_master = buildCdnUrl(masterS3Key);

    // Upload thumbnail
    const thumbS3Key = `${s3BaseKey}/thumb.webp`;
    await uploadFileToS3(thumbLocal, thumbS3Key, 'image/webp');
    processedUrls.thumb = buildCdnUrl(thumbS3Key);

    await updateFileStatus(pool, fileId, 'done', {
      processedUrls,
      s3KeyProcessed: s3BaseKey,
    });

  } finally {
    // ALWAYS cleanup temp files (Gotcha G-001)
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
