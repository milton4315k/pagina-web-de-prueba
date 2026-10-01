import { z } from 'zod';
import { list, listBySlug } from '../repositories/pizzas.repo.js';
import * as categoriasRepo from '../repositories/categorias.repo.js';

const querySchema = z.object({
  category: z.string().trim().min(1).max(60).optional(),
  featured: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  available: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

const CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';

export default async function pizzasRoutes(app) {
  app.get('/', { schema: { querystring: querySchema } }, async (request, reply) => {
    const { category, featured, available } = request.query;

    if (category) {
      const existe = await categoriasRepo.listBySlug(category);
      if (!existe) {
        reply.code(404);
        return { error: 'not_found', message: `No existe la categoría "${category}".` };
      }
    }

    reply.header('cache-control', CACHE_CONTROL);
    return { pizzas: await list({ category, featured, available }) };
  });

  app.get('/:slug', async (request, reply) => {
    const pizza = await listBySlug(request.params.slug);
    if (!pizza) {
      reply.code(404);
      return { error: 'not_found', message: 'No encontramos esa pizza.' };
    }
    reply.header('cache-control', CACHE_CONTROL);
    return { pizza };
  });
}