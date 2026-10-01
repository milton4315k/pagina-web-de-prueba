import { z } from 'zod';
import {
  STATUSES,
  list,
  getById,
  updateStatus,
  countsByStatus,
} from '../../repositories/pedidos.admin.repo.js';

const statusSchema = z.object({
  status: z.enum(STATUSES),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export default async function adminPedidosRoutes(app) {
  app.addHook('onRequest', app.requireAdmin);

  app.get('/orders', async (request) => {
    const { status, from, to, page } = request.query ?? {};

    if (status && !STATUSES.includes(status)) {
      const error = new Error(`Estado inválido: ${status}`);
      error.statusCode = 400;
      error.expose = true;
      throw error;
    }

    const result = await list({
      status,
      from,
      to,
      page: page ? Number(page) : 1,
    });

    return { ...result, counts: await countsByStatus() };
  });

  app.get('/orders/:id', {
    schema: { params: idParamSchema },
  }, async (request, reply) => {
    const order = await getById(request.params.id);
    if (!order) {
      reply.code(404);
      return { error: 'not_found', message: 'Pedido inexistente.' };
    }
    return { order };
  });

  app.patch('/orders/:id/status', {
    schema: { params: idParamSchema, body: statusSchema },
  }, async (request, reply) => {
    const order = await updateStatus(request.params.id, request.body.status);
    if (!order) {
      reply.code(404);
      return { error: 'not_found', message: 'Pedido inexistente.' };
    }

    app.log.info(
      { orderId: request.params.id, status: request.body.status, staff: request.admin.staff.id },
      'estado de pedido actualizado',
    );
    return { order };
  });
}