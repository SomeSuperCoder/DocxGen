import express from 'express';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { errorHandler } from './http/errorHandler.js';
import { sessionMiddleware } from './http/session.js';
import { createApiRouter } from './http/api.js';

/**
 * createApp — factory function that builds the Express application.
 *
 * Injected dependencies:
 *   log   — pino logger instance
 *   deps  — reserved for future modules (db, services, etc.)
 *
 * Design rationale (SOLID — D):
 *   The app doesn't import logger or services directly — it receives them.
 *   This makes the app testable: tests can pass a spy logger and mock deps
 *   without touching singletons.
 *
 * Express 5 note:
 *   Express 5 handles async errors natively — no need for express-async-errors.
 */
export function createApp({ log, deps = {} } = {}) {
  const app = express();

  // Body parsing — 1mb limit matches the draft size constraint (20k chars ≈ 60kb)
  app.use(express.json({ limit: '1mb' }));

  // Cookie parsing for web-client session tokens
  app.use(cookieParser());

  // Session middleware — creates sid cookie and attaches req.owner
  app.use(sessionMiddleware());

  // HTTP request logging — injects req.log for downstream use
  app.use(pinoHttp({ logger: log }));

  // API routes — health is always available; document routes require deps
  app.use(createApiRouter(deps));

  // Bot adapters: MAX webhook and VK callback.
  // Mounted before the error handler so their async errors are formatted the same way.
  for (const router of deps.routers ?? []) app.use(router);

  // Error handler — must be last middleware
  app.use(errorHandler(log));

  return app;
}
