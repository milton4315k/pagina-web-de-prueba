import fp from 'fastify-plugin';

const BEARER = /^Bearer\s+(.+)$/i;

/**
 * Identidad del cliente del Pase Nocturno.
 *
 * El `device_token` da acceso de LECTURA al pase y a pedir canjes. No puede
 * mover saldos: eso es solo del panel de admin. Por eso el token vive en
 * localStorage sin necesidad de que sea un secreto fuerte contra alguien con
 * acceso al dispositivo, pero igual se guarda hasheado en la base.
 */
export default fp(async function memberAuthPlugin(app) {
  app.decorate('requireMember', async function requireMember(request, reply) {
    const match = BEARER.exec(request.headers.authorization ?? '');
    const member = await app.membersRepo.resolveDevice(match?.[1]);

    if (!member) {
      reply.code(401).send({
        error: 'no_pase',
        message: 'No encontramos tu Pase Nocturno en este dispositivo.',
      });
      return;
    }

    request.member = member;
  });
});