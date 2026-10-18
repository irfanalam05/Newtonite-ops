import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { assertLoginAllowed, clearLoginFailures, loginKey, recordLoginFailure } from '../../middleware/loginLimiter.js';
import { AppError } from '../../lib/errors.js';
import { login, publicUser } from './auth.service.js';

export const router = Router();

const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) }).strict();

router.post('/auth/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const key = loginKey(req.ip, email);
  assertLoginAllowed(key);
  try {
    const data = await login(email, password);
    clearLoginFailures(key);
    res.json({ data });
  } catch (err) {
    if (err instanceof AppError && err.status === 401) recordLoginFailure(key);
    throw err;
  }
});

router.get('/auth/me', authenticate, (req, res) => {
  res.json({ data: publicUser(req.user) });
});
