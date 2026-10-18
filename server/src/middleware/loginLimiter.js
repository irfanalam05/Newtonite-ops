import { AppError } from '../lib/errors.js';

// Brute-force protection: after MAX_FAILS failed sign-ins for the same IP + email within the window, further
// attempts get 429 until the window expires. In-memory (per API process) — see "Known limitations".
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const fails = new Map(); // key -> { count, resetAt }

export const loginKey = (ip, email) => `${ip}|${String(email).toLowerCase()}`;

export function assertLoginAllowed(key) {
  const e = fails.get(key);
  if (!e) return;
  if (e.resetAt <= Date.now()) return void fails.delete(key);
  if (e.count >= MAX_FAILS) throw new AppError(429, 'RATE_LIMITED', 'Too many failed sign-in attempts. Please try again later.');
}

export function recordLoginFailure(key) {
  const now = Date.now();
  if (fails.size > 10_000) for (const [k, v] of fails) if (v.resetAt <= now) fails.delete(k); // bound memory
  const e = fails.get(key);
  if (!e || e.resetAt <= now) fails.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else e.count++;
}

export const clearLoginFailures = (key) => fails.delete(key);
export const resetLoginLimiter = () => fails.clear(); // for tests
