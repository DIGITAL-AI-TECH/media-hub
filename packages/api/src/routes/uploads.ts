import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import {
  createUpload, getUpload, incrementUploadFilesCount,
  createFile, getFilesByUpload, detectMediaType,
  buildS3Key, streamToS3, CreateUploadSchema, ProcessingJob
} from '@media-hub/shared';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

let processingQueue: Queue | null = null;

function getQueue(redis: Redis): Queue {
  if (!processingQueue) {
    processingQueue = new Queue('media-processing', { connection: redis });
    processingQueue.on('error', (err) => {
      // Log Redis connection errors so they surface in observability tools
      // instead of being silently swallowed. The Queue will auto-reconnect
      // via ioredis built-in retry logic.
      console.error({ err }, 'Processing queue connection error');
      // Reset singleton so it is recreated on next request if fatally closed
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        processingQueue = null;
      }
    });
  }
  return processingQueue;
}

export async function uploadRoutes(fastify: FastifyInstance) {
  // POST /v1/uploads — create upload session
  fastify.post('/v1/uploads', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreateUploadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const upload = await createUpload(fastify.db, request.tenant.id, parsed.data);
    return reply.status(201).send({
      upload_id: upload.id,
      status: upload.status,
      created_at: upload.created_at,
    });
  });

  // POST /v1/uploads/:uploadId/files — upload a file (streamed)
  fastify.post<{ Params: { uploadId: string } }>('/v1/uploads/:uploadId/files', { preHandler: requireAuth }, async (request, reply) => {
    const { uploadId } = request.params;

    // Verify upload belongs to tenant
    const upload = await getUpload(fastify.db, uploadId, request.tenant.id);
    if (!upload) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Upload not found' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'No file provided' });
    }

    const mimeType = data.mimetype || 'application/octet-stream';
    const mediaType = detectMediaType(mimeType);
    // Sanitize extension — allowlist alphanumeric only to prevent path traversal in S3 keys
    const rawExt = data.filename.split('.').pop() ?? 'bin';
    const fileExt = /^[a-zA-Z0-9]{1,10}$/.test(rawExt) ? rawExt : 'bin';

    // Pre-create file record to get an ID
    const fileRecord = await createFile(fastify.db, {
      uploadId,
      tenantId: request.tenant.id,
      originalName: data.filename,
      mimeType,
      mediaType,
      s3KeyRaw: 'pending', // will update below
    });

    const s3KeyRaw = buildS3Key(request.tenant.slug, 'raw', uploadId, `${fileRecord.id}.${fileExt}`);

    // Stream directly to S3 — never bufferize in memory
    try {
      await streamToS3(data.file, s3KeyRaw, mimeType);
    } catch (err) {
      // Log full error internally, expose only safe message to DB (never leak S3 internals)
      fastify.log.error({ err }, 'S3 upload failed');
      await fastify.db.query(`UPDATE files SET status = 'failed', error_message = $1 WHERE id = $2`, ['Upload to storage failed', fileRecord.id]);
      throw err;
    }

    // Update s3_key_raw and status to queued
    await fastify.db.query(
      `UPDATE files SET s3_key_raw = $1, status = 'queued' WHERE id = $2`,
      [s3KeyRaw, fileRecord.id]
    );

    // Increment upload files count
    await incrementUploadFilesCount(fastify.db, uploadId);

    // Enqueue processing job
    const job: ProcessingJob = {
      fileId: fileRecord.id,
      uploadId,
      tenantId: request.tenant.id,
      tenantSlug: request.tenant.slug,
      mediaType,
      s3KeyRaw,
      mimeType,
      originalName: data.filename,
    };

    const queue = getQueue(fastify.redis);
    await queue.add('process', job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    return reply.status(202).send({
      file_id: fileRecord.id,
      upload_id: uploadId,
      original_name: data.filename,
      media_type: mediaType,
      status: 'queued',
    });
  });

  // GET /v1/uploads/:uploadId — get upload with files
  fastify.get<{ Params: { uploadId: string } }>('/v1/uploads/:uploadId', { preHandler: requireAuth }, async (request, reply) => {
    const { uploadId } = request.params;
    const upload = await getUpload(fastify.db, uploadId, request.tenant.id);
    if (!upload) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Upload not found' });
    }
    const files = await getFilesByUpload(fastify.db, uploadId, request.tenant.id);
    return {
      upload_id: upload.id,
      status: upload.status,
      files_count: upload.files_count,
      external_ref: upload.external_ref,
      metadata: upload.metadata,
      created_at: upload.created_at,
      updated_at: upload.updated_at,
      files: files.map(f => ({
        file_id: f.id,
        original_name: f.original_name,
        media_type: f.media_type,
        mime_type: f.mime_type,
        status: f.status,
        processed_urls: f.processed_urls,
        error_message: f.error_message,
        created_at: f.created_at,
      })),
    };
  });
}
