import { messageSchema } from '../schemas/pedido.schema.js';
import * as mensajesRepo from '../repositories/mensajes.repo.js';

export default async function mensajesRoutes(app) {
  app.post('/', {
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: {
      body: messageSchema,
    },
  }, async (request, reply) => {
    const saved = await mensajesRepo.create(request.body);
    reply.code(201);
    return {
      message: 'Recibido. Te respondemos a la brevedad.',
      id: saved.id,
      createdAt: saved.created_at,
    };
  });
}