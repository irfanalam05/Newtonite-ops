import 'dotenv/config';
import { defineConfig } from 'vitest/config';

// Tests ALWAYS run against a dedicated database whose name ends in "_test".
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://newtonite:newtonite@localhost:5432/newtonite_test';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/globalSetup.js'],
    fileParallelism: false, // files share one database
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DB_URL,
      TEST_DATABASE_URL: TEST_DB_URL,
      JWT_SECRET: 'test-secret-0123456789-abcdefghij',
      BCRYPT_ROUNDS: '4',
    },
  },
});
