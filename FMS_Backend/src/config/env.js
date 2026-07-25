import dotenv from 'dotenv';

dotenv.config();

/**
 * Centralised, validated environment access.
 * Import `env` everywhere instead of touching process.env directly, so a
 * missing/typo'd variable fails loudly in one place.
 */
const nodeEnv = process.env.NODE_ENV || 'development';
const isProdEnv = nodeEnv === 'production';

// Dev/test fallbacks. These are intentionally NOT usable in production — see
// `secret()` below, which refuses them (or any missing/weak value) when
// NODE_ENV === 'production' so a real deployment can never boot insecure.
const DEV_JWT_SECRET = 'dev_insecure_secret_change_me';
const DEV_DEVICE_SALT = 'dev_insecure_device_salt_change_me';

const looksWeak = (v) =>
  !v || v.length < 16 || /change[_-]?me|insecure|example|placeholder/i.test(v);

/**
 * Resolve a required secret. In production a missing or obviously-weak value is
 * a hard startup error (fail fast) — never a silent insecure default. Outside
 * production we fall back to the dev value so `npm run dev`/tests just work.
 */
function secret(name, devFallback) {
  const v = process.env[name];
  if (isProdEnv) {
    if (looksWeak(v)) {
      throw new Error(
        `[env] ${name} must be set to a strong value in production ` +
          `(missing, too short, or a placeholder). Try: openssl rand -hex 32`
      );
    }
    return v;
  }
  return v || devFallback;
}

export const env = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fms',
  jwtSecret: secret('JWT_SECRET', DEV_JWT_SECRET),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  deviceSalt: secret('DEVICE_SALT', DEV_DEVICE_SALT),
  // Whether auth/device cookies carry the `Secure` attribute. Defaults to on in
  // production, but can be forced off (e.g. `COOKIE_SECURE=false`) for a
  // plain-HTTP demo where a Secure cookie would never be sent by the browser.
  cookieSecure:
    process.env.COOKIE_SECURE != null
      ? process.env.COOKIE_SECURE === 'true'
      : isProdEnv,
  clientOrigins: (process.env.CLIENT_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Product name used in email subjects/branding.
  appName: process.env.APP_NAME || 'Feedback Management',
  // Public URL of the SPA — used to build links inside emails. Falls back to
  // the first allowed origin so local development produces working links.
  appUrl:
    process.env.APP_URL ||
    (process.env.CLIENT_ORIGINS || 'http://localhost:5173').split(',')[0].trim(),

  // SMTP. When host+user are absent the mailer falls back to logging messages
  // to the console, so password reset still works end-to-end in development.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Feedback Management <no-reply@example.com>',
  },

  // Master switch for the digest scheduler.
  digestsEnabled: process.env.DIGESTS_ENABLED !== 'false',

  // How long a password-reset link stays valid.
  resetTokenMinutes: parseInt(process.env.RESET_TOKEN_MINUTES || '30', 10),
  // Accept both ADMIN_* and SEED_ADMIN_* names (the latter is used by docker-compose).
  seedAdminEmail: process.env.ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
  seedAdminPassword: process.env.ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD || '',
};

export const isProd = isProdEnv;
export const isTest = nodeEnv === 'test';
