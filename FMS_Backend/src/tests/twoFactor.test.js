/**
 * Two-factor authentication.
 *
 * The super admin owns every tenant on the platform and was protected by a
 * password alone. The RFC vectors below are the reason this is implemented
 * here rather than pulled in: there is nothing subtle left to get wrong once
 * they pass.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import {
  startTestDB, stopTestDB, resetDB, seedBasics, loginToken, ADMIN_PASSWORD,
  startTestServer, stopTestServer, target,
} from './helpers.js';
import { codeFor, toBase32, currentCode, verifyCode, generateSecret } from '../utils/totp.js';

jest.setTimeout(60_000);
let adminToken;

beforeAll(async () => { await startTestDB(); startTestServer(); });
afterAll(async () => { stopTestServer(); await stopTestDB(); });
beforeEach(async () => {
  await resetDB();
  await seedBasics();
  adminToken = await loginToken(request, 'admin@test.com', ADMIN_PASSWORD);
});

const auth = (r) => r.set('Authorization', `Bearer ${adminToken}`);

describe('the algorithm itself', () => {
  test('matches every RFC 6238 test vector', () => {
    /* If these pass, the implementation is correct — which is the whole
       argument for not adding a dependency to hold students' testimony. */
    const secret = toBase32(Buffer.from('12345678901234567890'));
    const vectors = [
      [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
      [1234567890, '89005924'], [2000000000, '69279037'],
    ];
    for (const [t, expected] of vectors) {
      expect(codeFor(secret, Math.floor(t / 30), 8)).toBe(expected);
    }
  });

  test('accepts one step of drift either side, and no more', () => {
    /* Phones drift and people finish typing a second late; a zero-width
       window punishes that for no gain. A wide one is just a longer-lived
       password. */
    const secret = generateSecret();
    const now = Date.now();
    expect(verifyCode(secret, currentCode(secret, now), { at: now })).toBe(true);
    expect(verifyCode(secret, currentCode(secret, now - 30_000), { at: now })).toBe(true);
    expect(verifyCode(secret, currentCode(secret, now + 30_000), { at: now })).toBe(true);
    expect(verifyCode(secret, currentCode(secret, now - 120_000), { at: now })).toBe(false);
  });

  test('rejects anything that is not six digits without comparing it', () => {
    const secret = generateSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '12 34 56']) {
      expect(verifyCode(secret, bad)).toBe(false);
    }
  });
});

describe('enrolment', () => {
  test('hands out a secret but does NOT switch it on', async () => {
    /* A secret handed out and enabled in one step locks people out when the
       QR code does not scan — and the account that most needs this is the one
       it is most costly to be locked out of. */
    const res = await auth(request(target()).post('/api/auth/2fa/start'));
    expect(res.status).toBe(200);
    expect(res.body.secret).toEqual(expect.any(String));
    expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);

    // Still signs in with the password alone.
    const login = await request(target()).post('/api/auth/login')
      .send({ email: 'admin@test.com', password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.token).toEqual(expect.any(String));
  });

  test('switching on requires proving the app actually works', async () => {
    const { body } = await auth(request(target()).post('/api/auth/2fa/start'));
    const bad = await auth(request(target()).post('/api/auth/2fa/enable')).send({ code: '000000' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('BAD_2FA_CODE');

    const good = await auth(request(target()).post('/api/auth/2fa/enable'))
      .send({ code: currentCode(body.secret) });
    expect(good.status).toBe(200);
    expect(good.body.enabled).toBe(true);
  });
});

describe('signing in once it is on', () => {
  let secret;
  beforeEach(async () => {
    const started = await auth(request(target()).post('/api/auth/2fa/start'));
    secret = started.body.secret;
    const enabled = await auth(request(target()).post('/api/auth/2fa/enable'))
      .send({ code: currentCode(secret) });
    adminToken = enabled.body.token; // enabling revokes earlier sessions
  });

  test('the password alone no longer returns a session', async () => {
    /* Returning a token and then asking for a code would mean the password
       had already bought a working session — the exact thing this prevents. */
    const res = await request(target()).post('/api/auth/login')
      .send({ email: 'admin@test.com', password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.twoFactorRequired).toBe(true);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user).toBeUndefined();
  });

  test('a wrong code is refused', async () => {
    const res = await request(target()).post('/api/auth/login')
      .send({ email: 'admin@test.com', password: ADMIN_PASSWORD, code: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('BAD_2FA_CODE');
  });

  test('the right code signs in', async () => {
    const res = await request(target()).post('/api/auth/login')
      .send({ email: 'admin@test.com', password: ADMIN_PASSWORD, code: currentCode(secret) });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  test('a wrong password is still refused even with a valid code', async () => {
    const res = await request(target()).post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'not-the-password', code: currentCode(secret) });
    expect(res.status).toBe(401);
  });

  test('turning it off needs the password AND a code', async () => {
    /* Someone at an unlocked laptop has neither — which is the person this
       is defending against. */
    const noCode = await auth(request(target()).post('/api/auth/2fa/disable'))
      .send({ currentPassword: ADMIN_PASSWORD });
    expect(noCode.status).toBe(400);

    const noPassword = await auth(request(target()).post('/api/auth/2fa/disable'))
      .send({ code: currentCode(secret) });
    expect(noPassword.status).toBe(400);

    const ok = await auth(request(target()).post('/api/auth/2fa/disable'))
      .send({ currentPassword: ADMIN_PASSWORD, code: currentCode(secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.enabled).toBe(false);
  });

  test('the secret is never returned by any read of the account', async () => {
    /* TOTP is symmetric, so the server must hold it — which makes it the one
       credential that could leak through an ordinary profile response. */
    const me = await auth(request(target()).get('/api/auth/me'));
    expect(JSON.stringify(me.body)).not.toContain(secret);
    expect(me.body.user.twoFactor?.secret).toBeUndefined();
  });
});
