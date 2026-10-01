import { listCategories } from '../repositories/categorias.repo.js';

export default async function categoriasRoutes(app) {
  app.get('/', async () => ({ categories: await listCategories() }));
}