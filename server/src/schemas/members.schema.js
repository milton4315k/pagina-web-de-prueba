import { z } from 'zod';
import { RULES } from '../lib/loyalty.js';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.')
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), {
    message: 'Fecha inválida.',
  });

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Escribí tu nombre.').max(120),
  // El teléfono llega de inputs con formatos distintos: lo normaliza el repo.
  phone: z.string().trim().min(8, 'Necesitamos un WhatsApp válido.').max(25),
  birthday: dateSchema.optional().or(z.literal('')),
  // Para identificar el dispositivo en el panel, si el cliente lo manda.
  deviceLabel: z.string().trim().max(120).optional(),
});

export const redeemSchema = z.object({
  benefit: z.enum(['welcome', 'drink', 'margherita', 'birthday'], {
    message: 'Beneficio desconocido.',
  }),
  notes: z.string().trim().max(300).optional(),
});

export const adjustPointsSchema = z
  .object({
    // El panel manda el saldo final, que es más intuitivo que un delta.
    points: z.coerce.number().int().min(0).max(1_000_000),
    note: z.string().trim().min(3, 'Contanos el motivo.').max(300),
  })
  .refine((value) => Number.isInteger(value.points), { message: 'Puntos inválidos.' });

export const memberListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  minPoints: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['points', 'newest', 'birthday']).default('points'),
});

export const welcomePoints = RULES.welcomePoints;