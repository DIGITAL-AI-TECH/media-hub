import { FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'crypto';
import { env } from '@media-hub/shared';

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!env.ADMIN_KEY) {
    request.log.warn('Admin API endpoint called but ADMIN_KEY is not configured');
    return reply.status(503).send({
      error: 'SERVICE_UNAVAILABLE',
      message: 'Admin API is not configured on this server',
    });
  }

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Missing or invalid Authorization header',
    });
  }

  const received = authHeader.slice(7);

  // Constant-time comparison to prevent timing attacks.
  // Hash both values with SHA-256 first so output is always 32 bytes,
  // eliminating length-based side-channel leaks.
  try {
    const h1 = crypto.createHash('sha256').update(received).digest();
    const h2 = crypto.createHash('sha256').update(env.ADMIN_KEY).digest();
    const isValid = crypto.timingSafeEqual(h1, h2);

    if (!isValid) {
      request.log.warn({ ip: request.ip }, 'Admin auth failed — invalid key');
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid admin key',
      });
    }
  } catch {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Invalid admin key',
    });
  }
}
