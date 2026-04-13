import { FastifyRequest, FastifyReply } from 'fastify';
import { findTenantByApiKey, updateApiKeyLastUsed } from '@media-hub/shared';

declare module 'fastify' {
  interface FastifyRequest {
    tenant: { id: string; slug: string; scopes: string[] };
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' });
  }
  const apiKey = authHeader.slice(7);
  const keyData = await findTenantByApiKey(request.server.db, apiKey);
  if (!keyData) {
    return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid API Key' });
  }
  // Fire and forget last_used update
  updateApiKeyLastUsed(request.server.db, keyData.id).catch(() => {});
  request.tenant = {
    id: keyData.tenant_id,
    slug: keyData.tenant_slug,
    scopes: keyData.scopes ?? keyData.tenant_scopes,
  };
}

export function requireScope(scope: string) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.tenant.scopes.includes(scope)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: `Missing required scope: ${scope}` });
    }
  };
}
