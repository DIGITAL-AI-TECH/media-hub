import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHmac } from 'crypto';
import { requireAuth, requireScope } from '../middleware/auth.js';
import { getFile, deleteFile, deleteFromS3, env } from '@media-hub/shared';

const MH_TOKEN_TTL_SECONDS = 4 * 60 * 60; // 4 horas

/**
 * Gera token HMAC-SHA256 para acesso ao media-hub CDN via Cloudflare Worker.
 * Formato: "<tenantSlug>:<expiresUnix>.<hmac_hex>"
 * O Worker valida este mesmo formato com o segredo compartilhado MH_TOKEN_SECRET.
 */
function generateMediaHubToken(tenantSlug: string, secret: string): string {
  const expires = Math.floor(Date.now() / 1000) + MH_TOKEN_TTL_SECONDS;
  const payload = `${tenantSlug}:${expires}`;
  const hmac = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${hmac}`;
}

function setMediaHubCookie(reply: FastifyReply, tokenValue: string): void {
  // Domain=.digital-ai.tech cobre media.digital-ai.tech E cdn.digital-ai.tech
  // SameSite=None + Secure: obrigatório para cross-origin (player em domínio diferente)
  // HttpOnly: hls.js envia cookies automaticamente via XHR — não precisa de acesso JS
  reply.header(
    'Set-Cookie',
    [
      `mh_access_token=${tokenValue}`,
      `Domain=.digital-ai.tech`,
      `Path=/`,
      `Max-Age=${MH_TOKEN_TTL_SECONDS}`,
      `Secure`,
      `SameSite=None`,
      `HttpOnly`,
    ].join('; ')
  );
}

function hasMediaHubUrls(processed_urls: Record<string, unknown> | null): boolean {
  if (!processed_urls) return false;
  return Object.values(processed_urls).some(
    (url) => typeof url === 'string' && url.includes('/media-hub/')
  );
}

export async function fileRoutes(fastify: FastifyInstance) {
  // GET /v1/files/:fileId
  fastify.get<{ Params: { fileId: string } }>('/v1/files/:fileId', { preHandler: requireAuth }, async (request, reply) => {
    const file = await getFile(fastify.db, request.params.fileId, request.tenant.id);
    if (!file) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'File not found' });
    }

    // Injeta cookie de acesso ao CDN quando o arquivo está processado e tem URLs media-hub
    if (env.MH_TOKEN_SECRET && file.status === 'done' && hasMediaHubUrls(file.processed_urls)) {
      const token = generateMediaHubToken(request.tenant.slug, env.MH_TOKEN_SECRET);
      setMediaHubCookie(reply, token);
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
    if (file.s3_key_raw) {
      deleteFromS3(file.s3_key_raw).catch((err) => {
        fastify.log.warn({ err, fileId: request.params.fileId }, 'S3 delete failed — storage orphan');
      });
    }

    await deleteFile(fastify.db, request.params.fileId, request.tenant.id);
    return reply.status(204).send();
  });
}
