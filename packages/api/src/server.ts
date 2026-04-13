import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { env } from '@media-hub/shared';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import { healthRoutes } from './routes/health.js';
import { uploadRoutes } from './routes/uploads.js';
import { fileRoutes } from './routes/files.js';
import { adminTenantRoutes } from './routes/admin/tenants.js';

async function build() {
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
  });

  await fastify.register(cors, {
    origin: env.ALLOWED_ORIGINS === '*' ? true : env.ALLOWED_ORIGINS.split(','),
    credentials: true,
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500MB
    },
  });

  await fastify.register(dbPlugin);
  await fastify.register(redisPlugin);

  await fastify.register(healthRoutes);
  await fastify.register(uploadRoutes);
  await fastify.register(fileRoutes);
  await fastify.register(adminTenantRoutes);

  fastify.setErrorHandler((error, _request, reply) => {
    fastify.log.error(error);
    const statusCode = error.statusCode || 500;
    reply.status(statusCode).send({
      error: error.code || 'INTERNAL_ERROR',
      message: statusCode === 500 ? 'Internal server error' : error.message,
      request_id: reply.request?.id,
    });
  });

  return fastify;
}

async function start() {
  const fastify = await build();
  try {
    await fastify.listen({ port: env.API_PORT, host: env.API_HOST });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
