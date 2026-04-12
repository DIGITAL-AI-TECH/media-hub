import { Pool } from 'pg';
import { FileStatus, MediaType, ProcessedUrls } from '../../types/schemas.js';

export interface File {
  id: string;
  upload_id: string;
  tenant_id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number | null;
  media_type: MediaType;
  s3_key_raw: string;
  s3_key_processed: string | null;
  status: FileStatus;
  processed_urls: ProcessedUrls | null;
  error_message: string | null;
  processing_started_at: Date | null;
  processing_done_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function detectMediaType(mimeType: string): MediaType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'generic';
}

export async function createFile(
  pool: Pool,
  data: {
    uploadId: string;
    tenantId: string;
    originalName: string;
    mimeType: string;
    sizeBytes?: number;
    mediaType: MediaType;
    s3KeyRaw: string;
  }
): Promise<File> {
  const result = await pool.query<File>(
    `INSERT INTO files (upload_id, tenant_id, original_name, mime_type, size_bytes, media_type, s3_key_raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [data.uploadId, data.tenantId, data.originalName, data.mimeType, data.sizeBytes || null, data.mediaType, data.s3KeyRaw]
  );
  return result.rows[0];
}

export async function getFile(pool: Pool, fileId: string, tenantId: string): Promise<File | null> {
  const result = await pool.query<File>(
    `SELECT * FROM files WHERE id = $1 AND tenant_id = $2`,
    [fileId, tenantId]
  );
  return result.rows[0] || null;
}

export async function getFilesByUpload(pool: Pool, uploadId: string, tenantId: string): Promise<File[]> {
  const result = await pool.query<File>(
    `SELECT * FROM files WHERE upload_id = $1 AND tenant_id = $2 ORDER BY created_at ASC`,
    [uploadId, tenantId]
  );
  return result.rows;
}

export async function updateFileStatus(
  pool: Pool,
  fileId: string,
  status: FileStatus,
  extra?: { processedUrls?: ProcessedUrls; errorMessage?: string; s3KeyProcessed?: string; tenantId?: string }
): Promise<void> {
  const updates: string[] = ['status = $2', 'updated_at = NOW()'];
  const params: unknown[] = [fileId, status];
  let idx = 3;

  if (status === 'processing') {
    updates.push(`processing_started_at = NOW()`);
  }
  if (status === 'done' || status === 'failed') {
    updates.push(`processing_done_at = NOW()`);
  }
  if (extra?.processedUrls) {
    updates.push(`processed_urls = $${idx++}`);
    params.push(JSON.stringify(extra.processedUrls));
  }
  if (extra?.errorMessage) {
    updates.push(`error_message = $${idx++}`);
    params.push(extra.errorMessage);
  }
  if (extra?.s3KeyProcessed) {
    updates.push(`s3_key_processed = $${idx++}`);
    params.push(extra.s3KeyProcessed);
  }

  // Always include tenant_id in WHERE when provided — enforces tenant isolation in worker context
  const tenantClause = extra?.tenantId ? ` AND tenant_id = $${idx}` : '';
  if (extra?.tenantId) params.push(extra.tenantId);

  await pool.query(
    `UPDATE files SET ${updates.join(', ')} WHERE id = $1${tenantClause}`,
    params
  );
}

export async function deleteFile(pool: Pool, fileId: string, tenantId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM files WHERE id = $1 AND tenant_id = $2`,
    [fileId, tenantId]
  );
  return (result.rowCount || 0) > 0;
}
