import { z } from 'zod';
import { list, markRead, unreadCount } from '../../repositories/mensajes.admin.repo.js';

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export default async function adminMensajesRoutes(app) {
  app.addHook('onRequest', app.requireAdmin);

  app.get('/messages', async (request) => {
    const unread = request.query?.unread === 'true';
    const page = request.query?.page ? Number(request.query.page) : 1;
    return {
      ...(await list({ unread, page })),
      unreadCount: await unreadCount(),
    };
  });

  app.patch('/messages/:id/read', {
    schema: { params: idParamSchema },
  }, async (request, reply) => {
    const message = await markRead(request.params.id);
    if (!message) {
      reply.code(404);
      return { error: 'not_found', message: 'Mensaje inexistente.' };
    }
    return { message };
  });
}