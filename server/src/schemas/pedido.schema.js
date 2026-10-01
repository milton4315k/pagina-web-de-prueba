import { z } from 'zod';

const argPhone = /^[0-9+\-\s()]{8,20}$/;

export const orderItemSchema = z.object({
  pizzaId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(50),
});

export const orderSchema = z
  .object({
    customer: z.object({
      name: z.string().trim().min(2, 'Falta el nombre.').max(120),
      phone: z.string().trim().min(8).max(20).regex(argPhone, 'Teléfono inválido.'),
      email: z.string().trim().email().max(160).optional().or(z.literal('')),
      notes: z.string().trim().max(500).optional(),
    }),
    fulfillmentType: z.enum(['pickup', 'delivery'], {
      message: 'Modalidad inválida.',
    }),
    address: z.string().trim().max(300).optional(),
    notes: z.string().trim().max(500).optional(),
    items: z.array(orderItemSchema).min(1, 'El pedido está vacío.').max(30),
  })
  .superRefine((value, ctx) => {
    if (value.fulfillmentType === 'delivery' && !value.address) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['address'],
        message: 'Para entrega hace falta la dirección.',
      });
    }
  });

export const messageSchema = z.object({
  name: z.string().trim().min(2, 'Falta el nombre.').max(120),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().max(160).optional().or(z.literal('')),
  subject: z.string().trim().max(160).optional(),
  message: z.string().trim().min(5, 'Escribinos un mensaje.').max(2000),
});