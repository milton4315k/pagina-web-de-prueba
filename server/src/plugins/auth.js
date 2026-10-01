import fp from 'fastify-plugin';

export default fp(async function authPlugin(app) {
  app.decorate('requireAdmin', async function requireAdmin(request, reply) {
    // Cookie es el camino normal; Bearer existe para curl y tests.
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    const rawToken = request.cookies?.nocturna_session || bearer;

    const session = await app.adminRepo.resolveSession(rawToken);
    if (!session) {
      // reply.send() es necesario: en un hook onRequest, devolver un valor
      // no corta la cadena y el handler igual se ejecuta.
      reply.code(401).send({
        error: 'unauthorized',
        message: 'Sesión inválida o vencida.',
      });
    }

    request.admin = session;
  });
});