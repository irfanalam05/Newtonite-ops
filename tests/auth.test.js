import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, anon, as, createFixtures, insertItem, pool, PASSWORD } from './helpers.js';
import { resetLoginLimiter } from '../server/src/middleware/loginLimiter.js';

let f;
beforeEach(async () => { f = await createFixtures(); resetLoginLimiter(); });

describe('authentication', () => {
  it('logs in with valid credentials and never returns the password hash', async () => {
    const r = await request(app).post('/api/v1/auth/login').send({ email: f.leadA.email, password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.data.token).toBeTruthy();
    expect(r.body.data.user.email).toBe(f.leadA.email);
    expect(JSON.stringify(r.body)).not.toMatch(/password|\$2[aby]\$/i);
  });

  it('rejects a wrong password and an unknown email with the same error', async () => {
    const bad = await request(app).post('/api/v1/auth/login').send({ email: f.leadA.email, password: 'nope' });
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@test.local', password: 'nope' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error).toEqual(bad.body.error);
  });

  it('throttles repeated failed sign-ins per IP+email (429), even for the right password afterwards', async () => {
    const attempt = (password) => request(app).post('/api/v1/auth/login').send({ email: f.viewerA.email, password });
    for (let i = 0; i < 10; i++) expect((await attempt('wrong')).status).toBe(401);
    const blocked = await attempt('wrong');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect((await attempt(PASSWORD)).status).toBe(429);
    // a different account is unaffected
    expect((await request(app).post('/api/v1/auth/login').send({ email: f.leadA.email, password: PASSWORD })).status).toBe(200);
  });

  it('rejects login for a deactivated user', async () => {
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [f.leadA.id]);
    const r = await request(app).post('/api/v1/auth/login').send({ email: f.leadA.email, password: PASSWORD });
    expect(r.status).toBe(401);
  });

  it('protects routes: missing, malformed and expired tokens give 401', async () => {
    expect((await anon.get('/api/v1/items')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer garbage')).body.error.code).toBe('INVALID_TOKEN');
    const expired = jwt.sign({ sub: String(f.leadA.id), exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET);
    const r = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a token signed with another secret or the "none" algorithm', async () => {
    const forged = jwt.sign({ sub: String(f.leadA.id) }, 'some-other-secret-value-1234');
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
    const none = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(`{"sub":"${f.leadA.id}"}`).toString('base64url') + '.';
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${none}`)).status).toBe(401);
  });

  it('stops honouring a valid token once the user is deactivated', async () => {
    expect((await as(f.leadA).get('/api/v1/auth/me')).status).toBe(200);
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [f.leadA.id]);
    expect((await as(f.leadA).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('applies membership changes immediately (roles are read from the DB, not the token)', async () => {
    const id = await insertItem({ teamId: f.teamA, createdBy: f.leadA.id });
    expect((await as(f.memberA).get(`/api/v1/items/${id}`)).status).toBe(200);
    await pool.query('DELETE FROM memberships WHERE user_id = $1', [f.memberA.id]);
    expect((await as(f.memberA).get(`/api/v1/items/${id}`)).status).toBe(404);
  });
});

describe('health', () => {
  it('reports liveness and database readiness', async () => {
    expect((await request(app).get('/api/v1/health')).body.status).toBe('ok');
    const r = await request(app).get('/api/v1/ready');
    expect(r.status).toBe(200);
    expect(r.body.database).toBe('up');
  });
});

