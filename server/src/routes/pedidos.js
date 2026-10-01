import { z } from 'zod';
import { orderSchema } from '../schemas/pedido.schema.js';
import * as pedidosRepo from '../repositories/pedidos.repo.js';

/** Envolvemos el schema de pedido para sumar el código de socio, opcional. */
const orderWithMemberSchema = orderSchema.extend({
  memberCode: z.string().trim().max(24).optional(),
});

export default async function pedidosRoutes(app) {
  app.post('/', {
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    schema: {
      body: orderWithMemberSchema,
    },
  }, async (request, reply) => {
    const { customer, items, fulfillmentType, address, notes, memberCode } = request.body;
    const result = await pedidosRepo.create({
      customer,
      items,
      fulfillmentType,
      address,
      notes,
      memberCode,
    });

    reply.code(201);
    return result;
  });

  app.get('/:orderCode', async (request, reply) => {
    const status = await pedidosRepo.getPublicStatus(request.params.orderCode);
    if (!status) {
      reply.code(404);
      return { error: 'not_found', message: 'No encontramos ese pedido.' };
    }
    return status;
  });
}