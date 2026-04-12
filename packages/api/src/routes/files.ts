import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth, requireScope } from '../middleware/auth.js';
import { getFile, deleteFile, deleteFromS3 } from '@media-hub/shared';

export async function fileRoutes(fastify: FastifyInstance) {
  // GET /v1/files/:fileId
  fastify.get<{ Params: { fileId: string } }>('/v1/files/:fileId', { preHandler: requireAuth }, async (request, reply) => {
    const file = await getFile(fastify.db, request.params.fileId, request.tenant.id);
    if (!file) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'File not found' });
    }
    return {
      file_id: file.id,
      upload_id: file.upload_id,
      original_name: file.original_name,
      media_type: file.media_type,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      status: file.status,
      processed_urls: file.processed_urls,
      error_message: file.error_message,
      processing_started_at: file.processing_started_at,
      processing_done_at: file.processing_done_at,
      created_at: file.created_at,
    };
  });

  // DELETE /v1/files/:fileId
  fastify.delete<{ Params: { fileId: string } }>('/v1/files/:fileId', {
    preHandler: [requireAuth, requireScope('media:delete')],
  }, async (request, reply) => {
    const file = await getFile(fastify.db, request.params.fileId, request.tenant.id);
    if (!file) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'File not found' });
    }

    // Delete from S3 (fire and forget errors — storage cleanup is best-effort)
    if (file.s3_key_raw) deleteFromS3(file.s3_key_raw).catch(() => {});

    await deleteFile(fastify.db, request.params.fileId, request.tenant.id);
    return reply.status(204).send();
  });
}
