import 'dotenv/config';

const env = process.env;

export const config = {
  nodeEnv: env.NODE_ENV ?? 'development',
  port: Number(env.PORT ?? 3000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://newtonite:newtonite@localhost:5432/newtonite',
  jwtSecret: env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? '8h',
  corsOrigin: (env.CORS_ORIGIN ?? 'http://localhost:5173').split(','),
  bcryptRounds: Number(env.BCRYPT_ROUNDS ?? 10),
  worker: {
    pollMs: Number(env.WORKER_POLL_MS ?? 2000),
    batchSize: 10,
    lockTimeoutSeconds: 60,
    backoffBaseSeconds: 5,
  },
};

if (!config.jwtSecret || config.jwtSecret.length < 16) {
  throw new Error('JWT_SECRET must be set (at least 16 characters). See .env.example.');
}
