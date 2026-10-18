import { Router } from 'express';
import { notFound, validation } from '../../lib/errors.js';
import * as svc from './workItems.service.js';
import {
  activityQuerySchema, commentSchema, createSchema, idempotencyKeySchema,
  listQuerySchema, transitionSchema, updateSchema,
} from './workItems.schemas.js';

export const router = Router();

const parseId = (raw) => {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) throw notFound('Work item');
  return id;
};
const cleanQuery = (q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== ''));

router.get('/items', async (req, res) => {
  res.json(await svc.listItems(req.user, listQuerySchema.parse(cleanQuery(req.query))));
});

router.post('/items', async (req, res) => {
  const input = createSchema.parse(req.body);
  let key;
  const rawKey = req.get('Idempotency-Key');
  if (rawKey !== undefined) {
    const parsed = idempotencyKeySchema.safeParse(rawKey);
    if (!parsed.success) throw validation('Invalid Idempotency-Key header', parsed.error.issues.map((i) => ({ path: 'Idempotency-Key', message: i.message })));
    key = parsed.data;
  }
  const r = await svc.createItem(req.user, input, key);
  if (r.replayed) res.setHeader('Idempotent-Replay', 'true');
  res.status(r.status).json(r.body);
});

router.get('/items/:id', async (req, res) => {
  res.json({ data: await svc.getItem(req.user, parseId(req.params.id)) });
});

router.patch('/items/:id', async (req, res) => {
  res.json({ data: await svc.updateItem(req.user, parseId(req.params.id), updateSchema.parse(req.body)) });
});

router.post('/items/:id/claim', async (req, res) => {
  res.json({ data: await svc.claimItem(req.user, parseId(req.params.id)) });
});

router.post('/items/:id/transition', async (req, res) => {
  res.json({ data: await svc.transitionItem(req.user, parseId(req.params.id), transitionSchema.parse(req.body)) });
});

router.post('/items/:id/comments', async (req, res) => {
  res.status(201).json({ data: await svc.addComment(req.user, parseId(req.params.id), commentSchema.parse(req.body)) });
});

router.get('/items/:id/activity', async (req, res) => {
  res.json(await svc.getActivity(req.user, parseId(req.params.id), activityQuerySchema.parse(cleanQuery(req.query))));
});

router.get('/dashboard', async (req, res) => {
  res.json({ data: await svc.dashboard(req.user) });
});
