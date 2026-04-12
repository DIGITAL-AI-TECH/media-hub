import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/v1/health', async () => ({ ok: true, timestamp: new Date().toISOString() }));

  fastify.get('/v1/health/auth', { preHandler: requireAuth }, async (request) => ({
    ok: true,
    tenant: request.tenant.slug,
    scopes: request.tenant.scopes,
  }));
}
