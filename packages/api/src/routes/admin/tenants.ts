import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../../middleware/admin-auth.js';
import {
  listTenants,
  findTenantById,
  createTenant,
  generateApiKey,
  createApiKey,
  listApiKeysByTenant,
  revokeApiKey,
} from '@media-hub/shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CreateTenantSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,64}$/, 'slug must be 2-64 lowercase alphanumeric or dash'),
  name: z.string().min(1).max(256),
  scopes: z.array(z.string()).optional(),
});

const CreateKeySchema = z.object({
  label: z.string().max(128).optional(),
  scopes: z.array(z.string()).optional(),
});

export async function adminTenantRoutes(fastify: FastifyInstance) {
  // GET /v1/admin/tenants — list all tenants
  fastify.get('/v1/admin/tenants', { preHandler: requireAdmin }, async (_request, _reply) => {
    const tenants = await listTenants(fastify.db);
    return { tenants };
  });

  // POST /v1/admin/tenants — create tenant
  fastify.post('/v1/admin/tenants', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = CreateTenantSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const tenant = await createTenant(
        fastify.db,
        parsed.data.slug,
        parsed.data.name,
        parsed.data.scopes
      );
      return reply.status(201).send(tenant);
    } catch (err: unknown) {
      // PostgreSQL unique violation on slug
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
        return reply.status(409).send({
          error: 'CONFLICT',
          message: `Tenant with slug '${parsed.data.slug}' already exists`,
        });
      }
      throw err;
    }
  });

  // GET /v1/admin/tenants/:tenantId/keys — list API keys for tenant
  fastify.get<{ Params: { tenantId: string } }>(
    '/v1/admin/tenants/:tenantId/keys',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { tenantId } = request.params;
      if (!UUID_RE.test(tenantId)) {
        return reply.status(422).send({ error: 'VALIDATION_ERROR', message: 'Invalid tenantId format' });
      }
      const tenant = await findTenantById(fastify.db, tenantId);
      if (!tenant) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Tenant not found' });
      }
      const keys = await listApiKeysByTenant(fastify.db, tenantId);
      return { tenant_id: tenantId, keys };
    }
  );

  // POST /v1/admin/tenants/:tenantId/keys — generate API key for tenant
  fastify.post<{ Params: { tenantId: string } }>(
    '/v1/admin/tenants/:tenantId/keys',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { tenantId } = request.params;
      if (!UUID_RE.test(tenantId)) {
        return reply.status(422).send({ error: 'VALIDATION_ERROR', message: 'Invalid tenantId format' });
      }

      const tenant = await findTenantById(fastify.db, tenantId);
      if (!tenant) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Tenant not found' });
      }

      const parsed = CreateKeySchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const { key, hash, prefix } = generateApiKey(tenant.slug);
      const scopes = parsed.data.scopes ?? tenant.scopes;
      const apiKey = await createApiKey(fastify.db, tenantId, hash, prefix, parsed.data.label, scopes);

      return reply.status(201).send({
        key_id: apiKey.id,
        key,        // plaintext — shown only once
        prefix: apiKey.key_prefix,
        label: apiKey.label,
        scopes: apiKey.scopes ?? scopes,
        created_at: apiKey.created_at,
      });
    }
  );

  // DELETE /v1/admin/keys/:keyId — revoke API key
  fastify.delete<{ Params: { keyId: string } }>(
    '/v1/admin/keys/:keyId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { keyId } = request.params;
      if (!UUID_RE.test(keyId)) {
        return reply.status(422).send({ error: 'VALIDATION_ERROR', message: 'Invalid keyId format' });
      }
      const revoked = await revokeApiKey(fastify.db, keyId);
      if (!revoked) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'API key not found or already revoked' });
      }
      return reply.status(204).send();
    }
  );
}
