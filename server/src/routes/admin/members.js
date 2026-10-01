import { z } from 'zod';
import {
  list,
  findById,
  history,
  addPoints,
  markWelcomeRedeemed,
  upcomingBirthdays,
  buildPass,
  loadRedemptions,
} from '../../repositories/members.repo.js';
import { withTransaction } from '../../db/pool.js';
import { BENEFITS } from '../../lib/loyalty.js';
import {
  adjustPointsSchema,
  memberListQuerySchema,
  redeemSchema,
} from '../../schemas/members.schema.js';

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const benefitsByKey = new Map(BENEFITS.map((benefit) => [benefit.key, benefit]));

export default async function adminMembersRoutes(app) {
  app.addHook('onRequest', app.requireAdmin);

  // --- Cumpleaños que se acercan ---------------------------------------
  // Va antes que /:id para que "birthdays" no se lea como un id.
  app.get('/birthdays', async () => {
    return { birthdays: await upcomingBirthdays({ days: 30 }) };
  });

  app.get('/', {
    schema: { querystring: memberListQuerySchema },
  }, async (request) => {
    const { search, minPoints, sort } = request.query;
    return list({ search, minPoints, sort });
  });

  app.get('/:id', {
    schema: { params: idParamSchema },
  }, async (request, reply) => {
    const member = await findById(request.params.id);
    if (!member) {
      reply.code(404);
      return { error: 'not_found', message: 'Socio inexistente.' };
    }

    const redemptions = await loadRedemptions(member.id);
    return {
      member,
      pass: buildPass({ ...member, redemptions }),
      history: await history(member.id),
    };
  });

  /**
   * Ajuste manual de puntos.
   *
   * Manda el saldo final, no un delta: es lo que el owner tiene en la cabeza
   * cuando corrige algo. Calculamos la diferencia y la dejamos asentada en el
   * libro con el motivo, para que el saldo siempre sea reconstruible.
   */
  app.patch('/:id/points', {
    schema: { params: idParamSchema, body: adjustPointsSchema },
  }, async (request, reply) => {
    const member = await findById(request.params.id);
    if (!member) {
      reply.code(404);
      return { error: 'not_found', message: 'Socio inexistente.' };
    }

    const { points, note } = request.body;
    const delta = points - member.points;

    if (delta !== 0) {
      await addPoints({
        memberId: member.id,
        delta,
        kind: delta > 0 ? 'manual_adjust' : 'manual_revoke',
        note,
        staffId: request.admin.staff.id,
      });
    }

    app.log.info(
      {
        memberId: member.id,
        from: member.points,
        to: points,
        staff: request.admin.staff.id,
        note,
      },
      'ajuste manual de puntos',
    );

    return { member: await findById(member.id) };
  });

  /**
   * Confirmación del canje. Esto es lo que descuenta los puntos: hasta que vos
   * no apretás acá, el beneficio queda pedido pero no consumido.
   */
  app.post('/:id/redeem', {
    schema: { params: idParamSchema, body: redeemSchema },
  }, async (request, reply) => {
    const member = await findById(request.params.id);
    if (!member) {
      reply.code(404);
      return { error: 'not_found', message: 'Socio inexistente.' };
    }

    const { benefit: key, notes } = request.body;
    const benefit = benefitsByKey.get(key);
    if (!benefit) {
      reply.code(400);
      return { error: 'unknown_benefit', message: 'Ese beneficio no existe.' };
    }

    const redemptions = await loadRedemptions(member.id);
    const estado = buildPass({ ...member, redemptions }).benefits.find(
      (item) => item.key === key,
    );

    if (estado.redeemed) {
      reply.code(409);
      return { error: 'already_redeemed', message: 'Ese beneficio ya está canjeado.' };
    }

    if (!estado.available) {
      reply.code(409);
      return { error: 'not_available', message: estado.reason };
    }

    // El 10% y el postre de cumpleaños no consumen puntos, solo se marcan usados.
    if (key === 'welcome') {
      await markWelcomeRedeemed(member.id);
      await recordRedemption(member.id, benefit.label, request.admin.staff.id);
    } else {
      // El CHECK (points >= 0) hace que un canje sin saldo revierta todo.
      const pointsAfter = await addPoints({
        memberId: member.id,
        delta: -benefit.threshold,
        kind: 'redemption',
        note: benefit.label,
        staffId: request.admin.staff.id,
      });
      return {
        member: await findById(member.id),
        remainingPoints: pointsAfter,
      };
    }

    app.log.info(
      { memberId: member.id, benefit: key, notes, staff: request.admin.staff.id },
      'canje confirmado',
    );

    return { member: await findById(member.id), remainingPoints: member.points };
  });
}

/** Asienta el canje sin mover el saldo (para beneficios que no cuestan puntos). */
function recordRedemption(memberId, note, staffId) {
  return withTransaction((client) =>
    client.query(
      `INSERT INTO loyalty_events (member_id, kind, points_delta, note, created_by)
       VALUES ($1, 'redemption', 0, $2, $3)`,
      [memberId, note, staffId],
    ),
  );
}
