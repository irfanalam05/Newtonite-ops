import pg from 'pg';

// Runs once before all test files: ensures the *_test database exists and has a clean, migrated schema.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://newtonite:newtonite@localhost:5432/newtonite_test';
  const dbName = new URL(url).pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(dbName)) {
    throw new Error(`Refusing to run tests against "${dbName}": database name must end in _test`);
  }
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const c = new pg.Client({ connectionString: admin.toString() });
  try {
    await c.connect();
  } catch (err) {
    throw new Error(`Cannot connect to PostgreSQL (${admin.host}). Start it with "docker compose up -d db". ${err.message}`);
  }
  const exists = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!exists.rowCount) await c.query(`CREATE DATABASE "${dbName}"`);
  await c.end();

  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET ??= 'test-secret-0123456789-abcdefghij';
  process.env.BCRYPT_ROUNDS ??= '4';
  const { pool } = await import('../server/src/db/pool.js');
  const { migrate } = await import('../server/src/db/migrate.js');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ log: () => {} });
  await pool.end();
}
