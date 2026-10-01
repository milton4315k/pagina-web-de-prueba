import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';

import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { zodValidatorCompiler } from './lib/zod-validator.js';
import { isDatabaseError } from './lib/db-errors.js';
import * as adminRepo from './repositories/admin.repo.js';
import * as membersRepo from './repositories/members.repo.js';
import authPlugin from './plugins/auth.js';
import memberAuthPlugin from './plugins/member-auth.js';

import healthRoutes from './routes/health.js';
import categoriasRoutes from './routes/categorias.js';
import pizzasRoutes from './routes/pizzas.js';
import pedidosRoutes from './routes/pedidos.js';
import mensajesRoutes from './routes/mensajes.js';
import membersRoutes from './routes/members.js';
import adminAuthRoutes from './routes/admin/auth.js';
import adminPedidosRoutes from './routes/admin/pedidos.js';
import adminMensajesRoutes from './routes/admin/mensajes.js';
import adminMembersRoutes from './routes/admin/members.js';

export async function buildApp({ logger = true } = {}) {
  const app = Fastify({
    logger,
    trustProxy: true,
  });

  // Zod como validador de Fastify: una sola definición de reglas, sin duplicar
// los schemas entre JSON Schema y Zod. Las dos rutas admin que usaban JSON
// Schema plano también están migradas a Zod.
app.setValidatorCompiler(zodValidatorCompiler);

  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
  });
  await app.register(rateLimit, {
    global: false,
    max: 120,
    timeWindow: '1 minute',
  });

  // Inyectados para que los tests puedan simular la base caída.
  app.decorate('adminRepo', adminRepo);
  app.decorate('membersRepo', membersRepo);
  app.decorate('pool', pool);
  await app.register(authPlugin);
  await app.register(memberAuthPlugin);

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      reply.code(error.statusCode ?? 400);
      return {
        error: 'validation_error',
        message: 'Revisá los datos enviados.',
        details: error.validation.map((issue) => ({
          field: issue.instancePath || issue.params?.missingProperty || '',
          message: issue.message,
        })),
      };
    }

    if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      reply.code(415);
      return { error: 'unsupported_media_type', message: 'Esperábamos application/json.' };
    }

    const statusCode = error.statusCode ?? 500;

    // La base no está disponible: 503, no 500. El health check de Render
    // usa /api/health, pero el frontend distingue "caído" de "con error".
    if (isDatabaseError(error)) {
      request.log.error({ err: error }, 'base de datos inaccesible');
      reply.code(503);
      return {
        error: 'database_unavailable',
        message: 'No pudimos conectar con la base. Probá en un momento.',
      };
    }

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'error no manejado');
      reply.code(500);
      return { error: 'internal_error', message: 'Algo falló de nuestro lado.' };
    }

    reply.code(statusCode);
    return {
      error: error.code ?? 'error',
      message: error.expose ? error.message : 'No pudimos procesar la solicitud.',
    };
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404);
    return { error: 'not_found', message: `Ruta inexistente: ${request.method} ${request.url}` };
  });

  await app.register(healthRoutes, { prefix: '/api/health' });
  await app.register(categoriasRoutes, { prefix: '/api/categories' });
  await app.register(pizzasRoutes, { prefix: '/api/pizzas' });
  await app.register(pedidosRoutes, { prefix: '/api/orders' });
  await app.register(mensajesRoutes, { prefix: '/api/messages' });
  await app.register(membersRoutes, { prefix: '/api/members' });

  await app.register(adminAuthRoutes, { prefix: '/api/admin' });
  await app.register(adminPedidosRoutes, { prefix: '/api/admin' });
  await app.register(adminMensajesRoutes, { prefix: '/api/admin' });
  await app.register(adminMembersRoutes, { prefix: '/api/admin' });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  return app;
}