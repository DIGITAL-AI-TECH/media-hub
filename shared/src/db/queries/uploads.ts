import { Pool } from 'pg';
import { UploadStatus } from '../../types/schemas.js';

export interface Upload {
  id: string;
  tenant_id: string;
  external_ref: string | null;
  status: UploadStatus;
  files_count: number;
  callback_url: string | null;
  callback_secret: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export async function createUpload(
  pool: Pool,
  tenantId: string,
  data: {
    external_ref?: string;
    callback_url?: string;
    callback_secret?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<Upload> {
  const result = await pool.query<Upload>(
    `INSERT INTO uploads (tenant_id, external_ref, callback_url, callback_secret, metadata)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, data.external_ref || null, data.callback_url || null, data.callback_secret || null, data.metadata ? JSON.stringify(data.metadata) : null]
  );
  return result.rows[0];
}

export async function getUpload(pool: Pool, uploadId: string, tenantId: string): Promise<Upload | null> {
  const result = await pool.query<Upload>(
    `SELECT * FROM uploads WHERE id = $1 AND tenant_id = $2`,
    [uploadId, tenantId]
  );
  return result.rows[0] || null;
}

export async function incrementUploadFilesCount(pool: Pool, uploadId: string): Promise<void> {
  await pool.query(
    `UPDATE uploads SET files_count = files_count + 1, updated_at = NOW() WHERE id = $1`,
    [uploadId]
  );
}

export async function updateUploadStatus(pool: Pool, uploadId: string, status: UploadStatus): Promise<boolean> {
  const result = await pool.query(
    `UPDATE uploads SET status = $1, updated_at = NOW()
     WHERE id = $2 AND status NOT IN ('done', 'partial', 'failed')
     RETURNING id`,
    [status, uploadId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function checkAndFinalizeUpload(pool: Pool, uploadId: string): Promise<{ allDone: boolean; hasFailures: boolean }> {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'done') as done_count,
       COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
       COUNT(*) as total_count
     FROM files WHERE upload_id = $1`,
    [uploadId]
  );
  const row = result.rows[0];
  const doneCount = parseInt(row.done_count);
  const failedCount = parseInt(row.failed_count);
  const totalCount = parseInt(row.total_count);
  const allDone = doneCount + failedCount === totalCount && totalCount > 0;
  return { allDone, hasFailures: failedCount > 0 };
}
