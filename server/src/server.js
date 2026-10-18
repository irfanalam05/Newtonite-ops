import { createApp } from './app.js';
import { config } from './config/index.js';
import { pool } from './db/pool.js';

const server = createApp().listen(config.port, () => console.log(`[api] listening on :${config.port}`));

const shutdown = () => {
  console.log('[api] shutting down');
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
