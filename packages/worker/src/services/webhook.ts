import * as crypto from 'crypto';
import { promises as dns } from 'dns';
import { getPool } from '@media-hub/shared';
import { checkAndFinalizeUpload, updateUploadStatus } from '@media-hub/shared';

// SSRF protection: block private/loopback/link-local IPs and non-HTTPS URLs
function isBlockedIp(ip: string): boolean {
  // Block loopback, RFC1918 private ranges, link-local, and AWS metadata endpoint
  const blocked = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
  ];
  return blocked.some(r => r.test(ip));
}

async function validateCallbackUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid callback URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Callback URL must use HTTPS');
  }
  const hostname = parsed.hostname;
  // Block literal IPs and hostnames that are obviously private
  if (hostname === 'localhost' || isBlockedIp(hostname)) {
    throw new Error(`Callback URL targets a blocked address: ${hostname}`);
  }
  // Resolve DNS and validate the resolved IP (prevents DNS rebinding attacks)
  try {
    const { address } = await dns.lookup(hostname);
    if (isBlockedIp(address)) {
      throw new Error(`Resolved IP ${address} is in blocked range`);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('blocked range')) throw err;
    throw new Error(`Failed to resolve hostname: ${hostname}`);
  }
}

async function sendWithRetry(url: string, payload: unknown, secret: string | null): Promise<void> {
  await validateCallbackUrl(url);
  const body = JSON.stringify(payload);
  const event = (payload as Record<string, string>).event || 'file.processed';

  const MAX_ATTEMPTS = 5;
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise(r => setTimeout(r, delay));
    }
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-MediaHub-Timestamp': timestamp,
      'X-MediaHub-Event': event,
    };
    if (secret) {
      const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
      headers['X-MediaHub-Signature'] = `sha256=${sig}`;
    }
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
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
  // Atomic conditional UPDATE — returns false if another worker already set the final status
  const updated = await updateUploadStatus(pool, uploadId, finalStatus);
  if (!updated) return;

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
