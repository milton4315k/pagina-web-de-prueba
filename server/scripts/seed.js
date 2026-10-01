// Seed idempotente: crea/actualiza categorías y pizzas del menú actual.
// Uso: node scripts/seed.js   (o npm run seed)

import 'dotenv/config';
import { pool } from '../src/db/pool.js';

const CATEGORIES = [
  { slug: 'classic', name: 'Clásicas', sortOrder: 1 },
  { slug: 'special', name: 'Especiales', sortOrder: 2 },
  { slug: 'vegetarian', name: 'Vegetales', sortOrder: 3 },
];

const PIZZAS = [
  {
    slug: 'nocturna-margherita',
    name: 'Nocturna Margherita',
    category: 'classic',
    price: 15500,
    imageUrl:
      'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=800&q=85',
    ingredients: 'Masa casa, mozzarella, tomate, albahaca, aceite de oliva',
    sortOrder: 1,
  },
  {
    slug: 'napoles-tradicional',
    name: 'Nápoles Tradicional',
    category: 'classic',
    price: 17200,
    imageUrl:
      'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=85',
    ingredients: 'Masa napolitana, tomate San Marzano, mozzarella, orégano',
    sortOrder: 2,
  },
  {
    slug: 'pepperoni-de-la-casa',
    name: 'Pepperoni de la Casa',
    category: 'special',
    price: 17900,
    imageUrl:
      'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=800&q=85',
    ingredients: 'Pepperoni, mozzarella, tomate, orégano, pimentón dulce',
    sortOrder: 3,
  },
  {
    slug: 'parma-nocturna',
    name: 'Parma Nocturna',
    category: 'special',
    price: 19500,
    imageUrl:
      'https://images.unsplash.com/photo-1594007654729-407eedc4be65?auto=format&fit=crop&w=800&q=85',
    ingredients: 'Prosciutto, rúcula, parmesano, miel de higos, mozzarella',
    sortOrder: 4,
  },
  {
    slug: 'jardin-de-la-casa',
    name: 'Jardín de la Casa',
    category: 'vegetarian',
    price: 16800,
    imageUrl:
      'https://images.unsplash.com/photo-1571997478779-2adcbbe9ab2f?auto=format&fit=crop&w=800&q=85',
    ingredients: 'Zucchini, champiñones, rúcula, tomate, mozzarella',
    sortOrder: 5,
  },
  {
    slug: 'calabresa-picante',
    name: 'Calabresa Picante',
    category: 'special',
    price: 18400,
    imageUrl:
      'https://images.unsplash.com/photo-1590947132387-155cc02f3212?auto=format&fit=crop&w=800&q=85',
    ingredients: 'Salame picante, chili en aceite, mozzarella, orégano',
    sortOrder: 6,
  },
  {
    slug: 'cuatro-quesos',
    name: 'Cuatro Quesos',
    category: 'vegetarian',
    price: 17500,
    imageUrl:
      'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=800&q=85',
    ingredients: 'Mozzarella, gorgonzola, parmesano, azul, albahaca',
    sortOrder: 7,
  },
  {
    slug: 'tricot-funghi',
    name: 'Tricot Funghi',
    category: 'classic',
    price: 17000,
    imageUrl:
      'https://images.unsplash.com/photo-1579751626657-72bc17010498?auto=format&fit=crop&w=800&q=85',
    ingredients: 'Mozzarella, champiñones, jamón cocido, trufa',
    sortOrder: 8,
  },
];

// Precios de las destacadas de index.html, si difieren del menú.
const FEATURED = new Set([
  'nocturna-margherita',
  'pepperoni-de-la-casa',
  'parma-nocturna',
  'cuatro-quesos',
]);

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const categoryIds = new Map();
    for (const category of CATEGORIES) {
      const { rows } = await client.query(
        `INSERT INTO categories (slug, name, sort_order)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE
           SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order
         RETURNING id`,
        [category.slug, category.name, category.sortOrder],
      );
      categoryIds.set(category.slug, rows[0].id);
    }

    for (const pizza of PIZZAS) {
      await client.query(
        `INSERT INTO pizzas (category_id, slug, name, description, price,
                             image_url, ingredients, is_featured, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (slug) DO UPDATE SET
           category_id  = EXCLUDED.category_id,
           name         = EXCLUDED.name,
           description  = EXCLUDED.description,
           price        = EXCLUDED.price,
           image_url    = EXCLUDED.image_url,
           ingredients  = EXCLUDED.ingredients,
           is_featured  = EXCLUDED.is_featured,
           sort_order   = EXCLUDED.sort_order`,
        [
          categoryIds.get(pizza.category),
          pizza.slug,
          pizza.name,
          pizza.description ?? '',
          pizza.price,
          pizza.imageUrl,
          pizza.ingredients,
          FEATURED.has(pizza.slug),
          pizza.sortOrder,
        ],
      );
    }

    // Un socio de ejemplo para probar el panel sin tener que registrarse.
    // Es el único dato inventado del seed.
    await client.query(
      `INSERT INTO members (member_code, name, phone, points, welcome_redeemed)
       VALUES ('#SOCIO-DEMO1', 'Socio de Prueba', '5491100000000', 65, FALSE)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name`,
    );

    await client.query('COMMIT');
    console.log(
      `Seed ok: ${CATEGORIES.length} categorías, ${PIZZAS.length} pizzas, 1 socio de ejemplo (#SOCIO-DEMO1).`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seed falló:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();