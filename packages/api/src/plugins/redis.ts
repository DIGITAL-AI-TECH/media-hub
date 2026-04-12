import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { env } from '@media-hub/shared';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

export default fp(async function redisPlugin(fastify: FastifyInstance) {
  const redis = new Redis(env.REDIS_URL);
  fastify.decorate('redis', redis);
  fastify.addHook('onClose', async () => {
    await redis.quit();
  });
});
