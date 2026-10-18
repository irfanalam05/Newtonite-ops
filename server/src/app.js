import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { api } from './routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { securityHeaders } from './middleware/security.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(cors({ origin: config.corsOrigin, exposedHeaders: ['Idempotent-Replay'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
