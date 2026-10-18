import { Router } from 'express';
import { authenticate } from './middleware/auth.js';
import { router as health } from './modules/health.routes.js';
import { router as auth } from './modules/auth/auth.routes.js';
import { router as items } from './modules/work-items/workItems.routes.js';
import { router as teams } from './modules/teams/teams.routes.js';

export const api = Router();
api.use(health); // public
api.use(auth); // /auth/login public, /auth/me protected inside
api.use(authenticate); // everything below requires a valid token
api.use(items);
api.use(teams);
