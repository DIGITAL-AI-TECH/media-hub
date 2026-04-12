import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { getPool } from '@media-hub/shared';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
  }
}

export default fp(async function dbPlugin(fastify: FastifyInstance) {
  const pool = getPool();
  fastify.decorate('db', pool);
  fastify.addHook('onClose', async () => {
    await pool.end();
  });
});
