import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { unauthenticated } from '../lib/errors.js';
import { loadUser } from '../modules/auth/auth.service.js';

/** Verifies the bearer token, then loads the user and their CURRENT team roles from the DB. */
export async function authenticate(req, res, next) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) throw unauthenticated();
  let payload;
  try {
    payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    throw err.name === 'TokenExpiredError'
      ? unauthenticated('TOKEN_EXPIRED', 'Your session has expired. Please sign in again.')
      : unauthenticated('INVALID_TOKEN', 'Invalid authentication token');
  }
  const user = await loadUser(Number(payload.sub));
  if (!user) throw unauthenticated('INVALID_TOKEN', 'Invalid authentication token');
  req.user = user;
  next();
}
