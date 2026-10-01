import 'dotenv/config';
import { z } from 'zod';

// En desarrollo apuntamos por default a la base local de Docker.
// En producción no hay defaults: si falta una variable, el arranque falla.
const DEV_DEFAULTS =
  process.env.NODE_ENV === 'production'
    ? {}
    : {
        PORT: '3000',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nocturna',
        DATABASE_MIGRATION_URL: 'postgresql://postgres:postgres@localhost:5432/nocturna',
        CORS_ORIGINS: 'http://localhost:4173,http://localhost:5173',
        ADMIN_WHATSAPP: '5491128493108',
        PUBLIC_SITE_URL: 'http://localhost:4173',
        SESSION_SECRET: 'dev-only-secret-cambiar-en-produccion-123456',
      };

for (const [key, value] of Object.entries(DEV_DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
    message: 'debe ser una connection string de Postgres',
  });

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: postgresUrl,
    DATABASE_MIGRATION_URL: postgresUrl,
    CORS_ORIGINS: z
      .string()
      .min(1)
      .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),
    ADMIN_WHATSAPP: z
      .string()
      .regex(/^\d{8,15}$/, 'debe ser el número en formato internacional sin + ni espacios'),
    PUBLIC_SITE_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET debe tener al menos 32 caracteres'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.SESSION_SECRET.includes('cambiar-esto')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SESSION_SECRET'],
        message: 'seguís con el valor de ejemplo en producción',
      });
    }
  });

export const env = schema.parse(process.env);

export const isProduction = env.NODE_ENV === 'production';