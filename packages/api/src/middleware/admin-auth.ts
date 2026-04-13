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

  // Constant-time comparison to prevent timing attacks
  try {
    const receivedBuf = Buffer.from(received);
    const expectedBuf = Buffer.from(env.ADMIN_KEY);
    // Buffers must be same length for timingSafeEqual
    const isValid =
      receivedBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(receivedBuf, expectedBuf);

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
