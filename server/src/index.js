import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = await buildApp();

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'cerrando servidor');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'error al cerrar');
      process.exit(1);
    }
  });
}

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error({ err: error }, 'no se pudo arrancar el servidor');
  process.exit(1);
}