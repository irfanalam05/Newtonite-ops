import { z } from 'zod';
import { PRIORITIES, STATUSES, TYPES } from '../authz/workflow.js';

const csv = (values) =>
  z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1).max(values.length));

export const VIEWS = ['assigned_to_me', 'unassigned_urgent', 'awaiting_my_approval'];

export const listQuerySchema = z.object({
  status: csv(STATUSES).optional(),
  priority: csv(PRIORITIES).optional(),
  type: csv(TYPES).optional(),
  assignee: z.string().regex(/^(me|unassigned|\d+)$/, 'assignee must be "me", "unassigned" or a user id').optional(),
  teamId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(100).optional(),
  view: z.enum(VIEWS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
});

const title = z.string().trim().min(3).max(200);
const dueAt = z.string().datetime({ offset: true }).nullable();

// .strict(): unknown keys (status, createdBy, version, ...) are rejected, not silently ignored.
export const createSchema = z
  .object({
    title,
    description: z.string().trim().max(5000).default(''),
    type: z.enum(TYPES),
    priority: z.enum(PRIORITIES).default('medium'),
    teamId: z.number().int().positive(),
    assigneeId: z.number().int().positive().nullable().optional(),
    dueAt: dueAt.optional(),
  })
  .strict();

export const updateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: title.optional(),
    description: z.string().trim().max(5000).optional(),
    type: z.enum(TYPES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assigneeId: z.number().int().positive().nullable().optional(),
    dueAt: dueAt.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, { message: 'Provide at least one field to change' });

export const transitionSchema = z
  .object({ to: z.enum(STATUSES), expectedVersion: z.number().int().positive().optional() })
  .strict();

export const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) }).strict();

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(100).optional(),
});

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/, 'Idempotency-Key must be 8-128 chars: letters, digits, _ . : -');
