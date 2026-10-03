import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * WHY THESE EXIST when there are already 214 API tests and 167 component
 * tests. The student submission flow is the one path in this product where a
 * failure is unrecoverable: a cohort gets one sitting, and if the form breaks
 * for them it does not get retried. It is also the path least covered by the
 * other two suites, because what can break is precisely what they cannot see —
 * a first-party cookie that does not survive the hop, a device lock keyed on
 * something the browser reports differently, a one-shot token consumed by a
 * double-submit. All three are browser facts.
 *
 * The backend runs against a disposable in-memory replica set (see
 * e2e/start-backend.mjs) but is otherwise the real server: real routes, real
 * middleware, real rate limiters, real transaction.
 */
const API_PORT = process.env.E2E_API_PORT || '5051';
const WEB_PORT = process.env.E2E_WEB_PORT || '5174';

export default defineConfig({
  testDir: './e2e/tests',
  /* e2e/review/ holds design-review tooling — a screenshot capture that
     asserts nothing. It lives outside testDir so it can never gate a build,
     and is run on demand with `npm run review:shots`. */
  // One worker. These tests share one database and one batch, and the thing
  // under test is "one submission per device" — parallel workers racing the
  // same device lock would produce failures that say nothing about the code.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: 'e2e/report', open: 'never' }]]
    : [['list']],
  outputDir: 'e2e/results',

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'node e2e/start-backend.mjs',
      // /api/ready, not /api/health: health says the process is up, ready also
      // proves Mongo answers. Starting tests against a server whose database
      // is still connecting produces flakes that look like product bugs.
      url: `http://localhost:${API_PORT}/api/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { E2E_API_PORT: API_PORT, E2E_WEB_PORT: WEB_PORT },
    },
    {
      /* The built app, served statically — not `vite dev`. A dev server has
         different module resolution and no minification, so it can pass while
         the thing users are served is broken. `vite preview` runs the actual
         build output. */
      command: `npm run build && npm run preview -- --port ${WEB_PORT} --strictPort`,
      cwd: 'FMS_Frontend',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      // No VITE_API_URL: the app calls same-origin /api and the preview
      // proxy forwards it, exactly as Vercel's rewrite does in production.
      env: { VITE_API_PROXY: `http://localhost:${API_PORT}` },
    },
  ],
});
