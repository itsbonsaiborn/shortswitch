import { buildApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

const start = async () => {
  const app = await buildApp();
  await app.listen({ host: '0.0.0.0', port: config.port });
  logger.info({ port: config.port }, 'server started');
};

start().catch((error) => {
  logger.error(error, 'startup failed');
  process.exit(1);
});
