import { z } from 'zod';
import * as adminRepo from '../../repositories/admin.repo.js';

const verifySchema = z.object({
  token: z.string().min(20).max(200),
});

export default async function adminAuthRoutes(app) {
  app.get('/session', async (request) => {
    const session = await adminRepo.resolveSession(
      request.cookies?.nocturna_session ||
        request.headers.authorization?.replace(/^Bearer\s+/i, ''),
    );
    return { authenticated: Boolean(session), staff: session?.staff ?? null };
  });

  app.post('/login/request', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (_request, reply) => {
    const result = await adminRepo.requestLogin();
    reply.code(201);
    return result;
  });

  app.post('/login/verify', {
    schema: { body: verifySchema },
  }, async (request, reply) => {
    const result = await adminRepo.verifyLogin(request.body.token);
    if (!result) {
      reply.code(401);
      return { error: 'invalid_token', message: 'El link venció o ya se usó.' };
    }

    reply.setCookie(
      adminRepo.SESSION_COOKIE,
      result.sessionToken,
      adminRepo.sessionCookieOptions(),
    );
    return { ok: true, staff: result.staff };
  });

  app.post('/logout', async (request, reply) => {
    const rawToken =
      request.cookies?.nocturna_session ||
      request.headers.authorization?.replace(/^Bearer\s+/i, '');
    await adminRepo.destroySession(rawToken);
    reply.clearCookie(adminRepo.SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}