/**
 * Single backend entry point.
 *
 * The web API and the MAX/VK/local adapters share one document service,
 * queue, database and AI worker. Messenger adapters are transport modules,
 * not separate backend services.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { installProcessGuards } from './shared/processGuards.js';
import { log } from './logger.js';
import { createRuntime } from './runtime.js';

const entry = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  const runtime = createRuntime();
  const server = runtime.app.listen(env.PORT, () => {
    const parts = [`http://localhost:${env.PORT}`, `ИИ: ${runtime.provider.name ?? env.AI_PROVIDER}`];
    if (env.MAX_ENABLED) parts.push(`MAX: ${env.MAX_MODE}`);
    if (env.VK_ENABLED) parts.push(`ВК: ${env.VK_MODE}`);
    log.info({ port: env.PORT }, `DocxGen — ${parts.join(' · ')}`);
  });

  installProcessGuards(log, 'backend');

  const shutdown = async (signal) => {
    log.info({ signal }, 'Остановка backend…');
    server.close();
    await runtime.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
