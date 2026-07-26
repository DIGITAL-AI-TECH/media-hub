import { Job } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import {
  ProcessingJob, ProcessedUrls,
  getPool, updateFileStatus,
  buildS3Key, buildCdnUrl, uploadFileToS3, downloadFromS3
} from '@media-hub/shared';

// Do NOT use ffmpeg-static — the bundled binary cannot seek to find moov atom
// at the end of phone recordings. System ffmpeg 8.0.1 (Alpine) handles this correctly.
// if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

const execFileAsync = promisify(execFile);

interface Resolution { label: string; height: number; bitrate: string; crf: number; preset: string; }

const RESOLUTIONS: Resolution[] = [
  { label: '360p',  height: 360,  bitrate: '800k',   crf: 23, preset: 'fast' },
  { label: '720p',  height: 720,  bitrate: '2500k',  crf: 23, preset: 'fast' },
  { label: '1080p', height: 1080, bitrate: '5000k',  crf: 23, preset: 'fast' },
  { label: '4k',    height: 2160, bitrate: '15000k', crf: 20, preset: 'slow' },
];

/**
 * Probe video height — internal helper.
 * Wraps ffmpeg.ffprobe with optional extra CLI args.
 */
async function tryProbeHeight(inputPath: string, extraArgs: string[] = []): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, extraArgs, (err, metadata) => {
      if (err) return reject(err);
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const h = videoStream?.height;
      if (!h) return reject(new Error('no video stream height'));
      resolve(h);
    });
  });
}

/**
 * Detect video height with multi-strategy fallback to handle exotic containers:
 * moov-at-end (phone recordings), fMP4 (iPhone streaming), HEVC in MP4, etc.
 *
 * Strategy 1 — Standard ffprobe: works for most files.
 * Strategy 2 — Large analyzeduration: may help for some moov-at-end files.
 * Strategy 3 — Stream-copy normalize: ffmpeg CLI can seek to find moov anywhere;
 *              the output MP4 will have moov at front, which ffprobe can read.
 * Strategy 3b — Error-tolerant normalize: same as 3 but with -err_detect ignore_err
 *               and -fflags +genpts for partially corrupted files.
 * Strategy 4 — Fallback 1080p: ffmpeg HLS encoding reads the raw file with
 *              -analyzeduration flags directly — no probe needed.
 *
 * Returns the detected (or fallback) height AND the best input path to use for
 * subsequent processing steps.
 */
async function detectVideoHeight(
  inputPath: string,
  tmpDir: string,
  log: (msg: string) => void,
): Promise<{ height: number; inputForProcessing: string }> {
  // Strategy 1: standard ffprobe
  try {
    const h = await tryProbeHeight(inputPath);
    return { height: h, inputForProcessing: inputPath };
  } catch (err) {
    log(`detectVideoHeight S1 failed: ${String(err)}`);
  }

  // Strategy 2: large analyzeduration/probesize — handles some moov-at-end cases
  try {
    const h = await tryProbeHeight(inputPath, [
      '-analyzeduration', '2147483647',
      '-probesize',       '2147483647',
    ]);
    return { height: h, inputForProcessing: inputPath };
  } catch (err) {
    log(`detectVideoHeight S2 failed: ${String(err)}`);
  }

  // Strategy 3: full re-encode (libx264) via system ffmpeg — handles fMP4 (iPhone),
  // HEVC in MP4, and moov-at-end files that stream-copy (-c copy) cannot remux.
  // We only encode the first 5 seconds (probe only, not final output) so this is fast.
  const normalizedPath = path.join(tmpDir, 'normalized.mp4');
  try {
    await execFileAsync('ffmpeg', [
      '-v', 'error',
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-preset', 'ultrafast',
      '-t', '5',
      '-movflags', '+faststart',
      normalizedPath,
    ], { maxBuffer: 10 * 1024 * 1024 });
    const h = await tryProbeHeight(normalizedPath);
    // Return normalizedPath as inputForProcessing — it has moov at front, safer for all steps
    return { height: h, inputForProcessing: normalizedPath };
  } catch (err) {
    log(`detectVideoHeight S3 failed: ${String(err)}`);
    await fs.unlink(normalizedPath).catch(() => {});
  }

  // Strategy 3b: error-tolerant re-encode — handles partially corrupted files or
  // unusual iPhone/Android container variants that strict mode rejects.
  const normalizedPath3b = path.join(tmpDir, 'normalized3b.mp4');
  try {
    await execFileAsync('ffmpeg', [
      '-err_detect', 'ignore_err',
      '-fflags', '+genpts+igndts',
      '-analyzeduration', '2147483647',
      '-probesize',       '2147483647',
      '-v', 'warning',
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-preset', 'ultrafast',
      '-t', '5',
      '-movflags', '+faststart',
      normalizedPath3b,
    ], { maxBuffer: 10 * 1024 * 1024 });
    const h = await tryProbeHeight(normalizedPath3b);
    return { height: h, inputForProcessing: normalizedPath3b };
  } catch (err) {
    log(`detectVideoHeight S3b failed: ${String(err)}`);
    await fs.unlink(normalizedPath3b).catch(() => {});
  }

  // Strategy 4: fallback — ffmpeg HLS encoding uses -analyzeduration flags directly
  // on the raw file, so HLS generation still works even without probing height.
  // Assume 1080p (the scale filter avoids upscaling via min() clamp below).
  log('detectVideoHeight S4: using fallback 1080p');
  return { height: 1080, inputForProcessing: inputPath };
}

async function generateHlsVariant(
  inputPath: string,
  outputDir: string,
  res: Resolution
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      // Large analyzeduration/probesize + error tolerance so ffmpeg can handle:
      // moov-at-end (phone recordings), partial corruption, unusual containers.
      .inputOptions([
        '-err_detect', 'ignore_err',
        '-fflags', '+genpts+igndts',
        '-analyzeduration', '2147483647',
        '-probesize',       '2147483647',
      ])
      .videoCodec('libx264')
      .audioCodec('aac')
      .addOption('-crf', String(res.crf))
      .addOption('-preset', res.preset)
      // min() clamp prevents upscaling if input is smaller than target height
      .addOption('-vf', `scale=-2:min(${res.height}\\,trunc(ih/2)*2)`)
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
      .inputOptions([
        '-err_detect', 'ignore_err',
        '-fflags', '+genpts+igndts',
        '-analyzeduration', '2147483647',
        '-probesize',       '2147483647',
      ])
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
    master += `${v.label}/${v.label}.m3u8\n\n`;
  }
  const masterPath = path.join(outputDir, 'master.m3u8');
  await fs.writeFile(masterPath, master);
  return masterPath;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT_RE  = /^[a-zA-Z0-9]{1,10}$/;

export async function videoProcessor(job: Job<ProcessingJob>): Promise<void> {
  const { fileId, uploadId, tenantId, tenantSlug, s3KeyRaw } = job.data;
  const pool = getPool();

  // Validate fileId before using in filesystem path (prevent path injection)
  if (!UUID_RE.test(fileId)) throw new Error(`Invalid fileId format: ${fileId}`);

  const tmpDir = `/tmp/media-hub-${fileId}`;

  try {
    await fs.mkdir(tmpDir, { recursive: true });
    await updateFileStatus(pool, fileId, 'processing', { tenantId });

    // Sanitize extension — allowlist only alphanumeric
    const rawExt = s3KeyRaw.split('.').pop() ?? 'mp4';
    const ext = EXT_RE.test(rawExt) ? rawExt : 'mp4';
    const localRaw = path.join(tmpDir, `raw.${ext}`);
    const s3Stream = await downloadFromS3(s3KeyRaw);
    await pipeline(s3Stream, createWriteStream(localRaw));

    // Validate downloaded file — detects incomplete S3 uploads early
    const { size } = await fs.stat(localRaw);
    console.error(`[media-hub] fileId=${fileId} s3Key=${s3KeyRaw} downloaded=${size}B (${(size / 1024 / 1024).toFixed(2)}MB)`);
    job.log(`Downloaded ${size} bytes (${(size / 1024 / 1024).toFixed(1)} MB) from S3`);
    if (size < 1024) {
      throw new Error(`File too small (${size} bytes) — S3 upload may be incomplete`);
    }

    // Diagnostic: read first 32 bytes as hex to detect file type/corruption.
    // Valid MP4/MOV: bytes 4-7 = "ftyp" (66 74 79 70) or bytes 0-3 = 00 00 00 xx + "mdat"
    // Valid WEBM:    bytes 0-3 = 1a 45 df a3 (EBML magic)
    // HTML error:    bytes 0-3 = 3c 21 44 4f (<!DO) or 3c 68 74 6d (html) or 48 54 54 50 (HTTP)
    // XML/JSON:      bytes 0 = 3c (<) or 7b ({)
    try {
      const fh = await fs.open(localRaw, 'r');
      const headerBuf = Buffer.alloc(32);
      const { bytesRead } = await fh.read(headerBuf, 0, 32, 0);
      await fh.close();
      const hexStr = headerBuf.slice(0, bytesRead).toString('hex');
      const asciiStr = headerBuf.slice(0, bytesRead).toString('ascii').replace(/[^\x20-\x7e]/g, '.');
      console.error(`[media-hub] FILE HEADER fileId=${fileId} hex=${hexStr} ascii=${asciiStr}`);
      job.log(`File header hex: ${hexStr} | ascii: ${asciiStr}`);
    } catch (hexErr) {
      console.error(`[media-hub] WARNING: could not read file header fileId=${fileId}: ${String(hexErr)}`);
      job.log(`Warning: could not read file header: ${String(hexErr)}`);
    }

    // Detect height with multi-strategy fallback (Strategy 1-4)
    const logFn = (msg: string) => { console.error(`[media-hub] detectVideoHeight fileId=${fileId}: ${msg}`); job.log(msg); };
    const { height: originalHeight, inputForProcessing } = await detectVideoHeight(localRaw, tmpDir, logFn);
    console.error(`[media-hub] height=${originalHeight}px inputForProcessing=${path.basename(inputForProcessing)} fileId=${fileId}`);
    job.log(`Video height: ${originalHeight}px | input: ${path.basename(inputForProcessing)}`);

    // Generate thumbnail
    const thumbLocal = path.join(tmpDir, 'thumb.webp');
    await generateThumbnail(inputForProcessing, thumbLocal);

    // Determine which resolutions to generate (no upscale — scale filter clamps via min())
    const applicableResolutions = RESOLUTIONS.filter(r => r.height <= originalHeight);
    if (applicableResolutions.length === 0) applicableResolutions.push(RESOLUTIONS[0]);

    // Generate HLS for each resolution
    const processedUrls: ProcessedUrls = {};
    const s3BaseKey = buildS3Key(tenantSlug, 'processed', uploadId, fileId, 'video');

    for (const res of applicableResolutions) {
      const variantDir = path.join(tmpDir, res.label);
      await fs.mkdir(variantDir, { recursive: true });
      await generateHlsVariant(inputForProcessing, variantDir, res);

      // Upload all .ts segments and .m3u8 for this variant
      const variantFiles = await fs.readdir(variantDir);
      for (const fname of variantFiles) {
        const localPath = path.join(variantDir, fname);
        const safeFname = path.basename(fname);
        const s3Key = `${s3BaseKey}/${res.label}/${safeFname}`;
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
      tenantId,
    });

  } catch (processingError) {
    // On the final attempt, mark as 'failed' so the ifans frontend stops polling
    // and can show the user a clear error instead of an infinite spinner.
    const isLastAttempt = (job.attemptsMade + 1) >= (job.opts.attempts ?? 1);
    if (isLastAttempt) {
      const errMsg = String(processingError instanceof Error ? processingError.message : processingError).slice(0, 500);
      await updateFileStatus(pool, fileId, 'failed', {
        tenantId,
        errorMessage: errMsg,
      }).catch(() => { /* best-effort — don't shadow the original error */ });
    }
    throw processingError;

  } finally {
    // ALWAYS cleanup temp files (Gotcha G-001)
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
