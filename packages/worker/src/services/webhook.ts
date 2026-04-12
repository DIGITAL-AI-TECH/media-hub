import crypto from 'crypto';
import { getPool } from '@media-hub/shared';
import { checkAndFinalizeUpload, updateUploadStatus } from '@media-hub/shared';

async function sendWithRetry(url: string, payload: unknown, secret: string | null, attempt = 0): Promise<void> {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-MediaHub-Timestamp': timestamp,
    'X-MediaHub-Event': (payload as Record<string, string>).event || 'file.processed',
  };

  if (secret) {
    const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    headers['X-MediaHub-Signature'] = `sha256=${sig}`;
  }

  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    if (attempt < 4) {
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(r => setTimeout(r, delay));
      return sendWithRetry(url, payload, secret, attempt + 1);
    }
    throw err;
  }
}

export async function sendFileProcessedCallback(
  uploadId: string,
  fileId: string,
  tenantSlug: string,
  externalRef: string | null,
  processedUrls: Record<string, string>,
  mediaType: string,
  callbackUrl: string,
  callbackSecret: string | null
): Promise<void> {
  await sendWithRetry(callbackUrl, {
    event: 'file.processed',
    upload_id: uploadId,
    file_id: fileId,
    tenant: tenantSlug,
    external_ref: externalRef,
    media_type: mediaType,
    status: 'done',
    processed_urls: processedUrls,
    timestamp: new Date().toISOString(),
  }, callbackSecret);
}

export async function checkAndNotifyUploadDone(
  uploadId: string,
  tenantSlug: string,
  externalRef: string | null,
  callbackUrl: string | null,
  callbackSecret: string | null
): Promise<void> {
  const pool = getPool();
  const { allDone, hasFailures } = await checkAndFinalizeUpload(pool, uploadId);
  if (!allDone) return;

  const finalStatus = hasFailures ? 'partial' : 'done';
  await updateUploadStatus(pool, uploadId, finalStatus);

  if (!callbackUrl) return;

  await sendWithRetry(callbackUrl, {
    event: 'upload.done',
    upload_id: uploadId,
    tenant: tenantSlug,
    external_ref: externalRef,
    status: finalStatus,
    timestamp: new Date().toISOString(),
  }, callbackSecret);
}
