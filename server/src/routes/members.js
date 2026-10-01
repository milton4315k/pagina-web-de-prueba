import { BENEFITS, RULES, memberCodeLabel } from '../lib/loyalty.js';
import { buildWhatsappUrl } from '../lib/whatsapp.js';
import { registerSchema, redeemSchema } from '../schemas/members.schema.js';
import { env } from '../config/env.js';
import * as membersRepo from '../repositories/members.repo.js';

const benefitsByKey = new Map(BENEFITS.map((benefit) => [benefit.key, benefit]));

export default async function membersRoutes(app) {
  // --- Registro ---------------------------------------------------------
  // Idempotente por teléfono: si el número ya existe, devuelve el pase.
  app.post('/', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    schema: { body: registerSchema },
  }, async (request, reply) => {
    const { name, phone, birthday, deviceLabel } = request.body;
    const { member, token, created } = await membersRepo.register(
      { name, phone, birthday: birthday || null },
      deviceLabel,
    );

    app.log.info({ memberId: member.id, created }, 'registro de socio');

    reply.code(created ? 201 : 200);
    return {
      token,
      created,
      pass: membersRepo.buildPass(member),
    };
  });

  // --- El pase de este dispositivo --------------------------------------
  app.get('/me', { onRequest: app.requireMember }, async (request) => {
    const redemptions = await membersRepo.loadRedemptions(request.member.id);
    return { pass: membersRepo.buildPass({ ...request.member, redemptions }) };
  });

  // --- Mandar el código por WhatsApp ------------------------------------
  // El mensaje va al LOCAL, no al propio cliente: es el local el que tiene que
  // ver el código para activarlo y para ubicar al socio en el panel.
  app.post('/request-code', {
    onRequest: app.requireMember,
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const member = request.member;

    const message = [
      '¡Hola Nocturna Pizza!',
      `Me acabo de registrar en la web como ${member.name}.`,
      `Mi código es ${memberCodeLabel(member.memberCode)}.`,
      '',
      `Quiero activar mis ${RULES.welcomePoints} puntos de bienvenida.`,
    ].join('\n');

    request.log.info({ memberId: member.id }, 'el socio pidió mandar su código');

    return {
      whatsappUrl: buildWhatsappUrl(env.ADMIN_WHATSAPP, message),
      memberCode: memberCodeLabel(member.memberCode),
    };
  });

  // --- Canjear un beneficio ---------------------------------------------
  // No descuenta puntos: el canje lo confirmás vos desde el panel. Así el
  // cliente puede pedirlo pero no ejecutarlo solo.
  app.post('/redeem', {
    onRequest: app.requireMember,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    schema: { body: redeemSchema },
  }, async (request, reply) => {
    const { benefit: key, notes } = request.body;
    const benefit = benefitsByKey.get(key);
    const member = request.member;

    if (!benefit) {
      reply.code(400);
      return { error: 'unknown_benefit', message: 'Ese beneficio no existe.' };
    }

    const redemptions = await membersRepo.loadRedemptions(member.id);
    const pass = membersRepo.buildPass({ ...member, redemptions });
    const estado = pass.benefits.find((item) => item.key === key);

    if (estado.redeemed) {
      reply.code(409);
      return {
        error: 'already_redeemed',
        message: 'Ese beneficio ya lo canjeaste.',
      };
    }

    if (!estado.available) {
      reply.code(409);
      return {
        error: 'not_available',
        message: estado.reason,
      };
    }

    const message = [
      'Hola Nocturna Pizza.',
      'Quiero canjear un beneficio de mi Pase Nocturno.',
      '',
      `Código: ${memberCodeLabel(member.memberCode)}`,
      `Socio: ${member.name}`,
      `Beneficio: ${benefit.label}`,
      `Puntos: ${member.points}`,
      notes ? `Detalle: ${notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    app.log.info(
      { memberId: member.id, benefit: key },
      'canje solicitado por el cliente',
    );

    return {
      status: 'requested',
      message: 'Le escribimos al local para confirmar. Tus puntos quedan hasta que lo confirmemos.',
      whatsappUrl: buildWhatsappUrl(env.ADMIN_WHATSAPP, message),
      benefit: key,
      points: member.points,
    };
  });
}
