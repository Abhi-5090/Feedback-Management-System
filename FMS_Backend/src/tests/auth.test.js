import { jest } from '@jest/globals';
import request from 'supertest';
import { app, startTestDB, stopTestDB, resetDB, seedBasics, makeTrainer } from './helpers.js';
import { sentMail } from '../services/emailService.js';
import { PasswordResetToken } from '../models/PasswordResetToken.js';
import { User } from '../models/User.js';

jest.setTimeout(60000);

beforeAll(startTestDB);
afterAll(stopTestDB);
beforeEach(async () => {
  await resetDB();
  await seedBasics();
  sentMail.length = 0;
});

const login = (email, password) =>
  request(app).post('/api/auth/login').send({ email, password });

describe('Password reset', () => {
  test('never reveals whether an email is registered', async () => {
    const unknown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@nowhere.com' });
    const known = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'admin@test.com' });

    // Identical status AND body — anything else is an enumeration oracle.
    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
  });

  test('emails a reset link to a real account only', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@nowhere.com' });
    expect(sentMail).toHaveLength(0);

    await request(app).post('/api/auth/forgot-password').send({ email: 'admin@test.com' });
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].to).toBe('admin@test.com');
    expect(sentMail[0].text).toMatch(/reset-password\?token=[a-f0-9]{64}/);
  });

  test('stores only a HASH of the token, never the raw value', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: 'admin@test.com' });
    const raw = sentMail[0].text.match(/token=([a-f0-9]{64})/)[1];
    const grant = await PasswordResetToken.findOne({});
    expect(grant.tokenHash).not.toBe(raw);
    expect(grant.tokenHash).toHaveLength(64);
  });

  test('resets the password and is single-use', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: 'admin@test.com' });
    const token = sentMail[0].text.match(/token=([a-f0-9]{64})/)[1];

    const ok = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'BrandNew@1' });
    expect(ok.status).toBe(200);

    expect((await login('admin@test.com', 'adminpass')).status).toBe(401);
    expect((await login('admin@test.com', 'BrandNew@1')).status).toBe(200);

    // Replaying the same link must fail.
    const replay = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'Another@1' });
    expect(replay.status).toBe(400);
  });

  test('rejects an expired grant', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: 'admin@test.com' });
    const token = sentMail[0].text.match(/token=([a-f0-9]{64})/)[1];
    await PasswordResetToken.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'BrandNew@1' });
    expect(res.status).toBe(400);
  });

  test('a second request invalidates the first link', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: 'admin@test.com' });
    const first = sentMail[0].text.match(/token=([a-f0-9]{64})/)[1];
    await request(app).post('/api/auth/forgot-password').send({ email: 'admin@test.com' });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: first, newPassword: 'BrandNew@1' });
    expect(res.status).toBe(400);
  });
});

describe('Forced password change', () => {
  async function issuedTrainer() {
    const t = await makeTrainer('gated@test.com');
    await User.updateOne({ _id: t._id }, { mustChangePassword: true });
    const res = await login('gated@test.com', 'trainerpass');
    return res.body.token;
  }

  test('blocks every data route until the password is changed', async () => {
    const token = await issuedTrainer();
    for (const path of ['/api/dashboard/trainer/me', '/api/analytics/classes', '/api/export/trainer/me']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
  });

  test('still allows reading and updating the account itself', async () => {
    const token = await issuedTrainer();
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);

    const changed = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'trainerpass', newPassword: 'MyOwn@2026' });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
  });

  test('unlocks the app once a new password is chosen', async () => {
    const token = await issuedTrainer();
    await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'trainerpass', newPassword: 'MyOwn@2026' });

    const fresh = await login('gated@test.com', 'MyOwn@2026');
    const res = await request(app)
      .get('/api/dashboard/trainer/me')
      .set('Authorization', `Bearer ${fresh.body.token}`);
    expect(res.status).toBe(200);
  });
});

describe('Self-service account', () => {
  test('changing a password requires the current one', async () => {
    const { body } = await login('admin@test.com', 'adminpass');
    const noCurrent = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${body.token}`)
      .send({ newPassword: 'Whatever@1' });
    expect(noCurrent.status).toBe(400);

    const wrongCurrent = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${body.token}`)
      .send({ currentPassword: 'nope', newPassword: 'Whatever@1' });
    expect(wrongCurrent.status).toBe(401);
  });
});

describe('Welcome email', () => {
  test('a newly created trainer is emailed and must change their password', async () => {
    const { body } = await login('admin@test.com', 'adminpass');
    const res = await request(app)
      .post('/api/trainers')
      .set('Authorization', `Bearer ${body.token}`)
      .send({ name: 'Fresh Trainer', email: 'fresh@test.com', password: 'Issued@123' });

    expect(res.status).toBe(201);
    const created = await User.findOne({ email: 'fresh@test.com' });
    expect(created.mustChangePassword).toBe(true);
    expect(sentMail.some((m) => m.to === 'fresh@test.com')).toBe(true);
  });
});
