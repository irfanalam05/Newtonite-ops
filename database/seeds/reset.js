// Drops EVERYTHING in the target database, migrates, and reseeds. Development only.
import { config } from '../../server/src/config/index.js';
import { pool } from '../../server/src/db/pool.js';
import { migrate } from '../../server/src/db/migrate.js';
import { seed } from './seed.js';

if (config.nodeEnv === 'production') {
  console.error('Refusing to reset a production database.');
  process.exit(1);
}
try {
  console.log(`[reset] dropping and recreating schema in ${new URL(config.databaseUrl).pathname}`);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await seed();
} catch (err) {
  console.error('[reset] failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
