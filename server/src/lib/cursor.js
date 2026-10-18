import { AppError } from './errors.js';

// Keyset cursor for (updated_at DESC, id DESC). Timestamps travel as Postgres text to keep
// microsecond precision (JS Dates only hold milliseconds, which would skip/duplicate rows).
const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:?\d{2})?$/;

export function encodeCursor({ ts, id }) {
  return Buffer.from(JSON.stringify({ t: ts, i: id })).toString('base64url');
}

export function decodeCursor(raw) {
  const bad = () => new AppError(400, 'INVALID_CURSOR', 'The pagination cursor is invalid');
  let obj;
  try {
    obj = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (!obj || typeof obj.t !== 'string' || !TS_RE.test(obj.t) || !Number.isSafeInteger(obj.i) || obj.i < 1) throw bad();
  return { ts: obj.t, id: obj.i };
}

// Simple id cursor for the (ascending) activity timeline.
export const encodeIdCursor = (id) => Buffer.from(String(id)).toString('base64url');
export function decodeIdCursor(raw) {
  const s = Buffer.from(raw, 'base64url').toString('utf8');
  if (!/^\d{1,15}$/.test(s)) throw new AppError(400, 'INVALID_CURSOR', 'The pagination cursor is invalid');
  return Number(s);
}
