import { checkDatabase } from '../db/health.js';

export default async function healthRoutes(app) {
  app.get('/', async (request, reply) => {
    try {
      const latencyMs = await checkDatabase();
      return { status: 'ok', db: 'up', latencyMs };
    } catch (error) {
      // El error handler global ya clasifica y loguea los fallos de base.
      request.log.error({ err: error }, 'health: base de datos inaccesible');
      reply.code(503);
      return { status: 'degraded', db: 'down' };
    }
  });
}