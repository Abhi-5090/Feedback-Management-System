import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { ADMIN } from '../seed.mjs';

/** Design-review capture. Asserts nothing — excluded from the suite by testIgnore. */
const HERE = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(HERE, '..', '.fixtures.json'), 'utf8'));
const shot = (p) => join(HERE, '..', 'shots', p);

const ADMIN_PAGES = [
  ['', 'dashboard'], ['feedbacks', 'feedbacks'], ['trainers', 'mentors'],
  ['compare', 'compare'], ['cohorts', 'cohorts'], ['classes', 'classes'],
  ['parameters', 'parameters'], ['batches', 'batches'], ['phases', 'phases'], ['audit', 'audit'],
  ['settings', 'settings'],
];

/* Mobile is reviewed as its own pass rather than as an afterthought. The
   summary strips collapse to a single column there, the sidebar becomes a
   drawer, and the tables scroll — none of which is visible at 1440px. */
for (const [theme, width, tag] of [
  ['light', 1440, 'light'],
  ['dark', 1440, 'dark'],
  ['dark', 390, 'mobile-dark'],
  ['light', 390, 'mobile-light'],
]) {
  test(`capture ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await page.addInitScript((t) => window.localStorage.setItem('fms_theme', t), theme);

    await page.goto('/login');
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot(`${tag}-00-login.png`) });

    await page.locator('#email').fill(ADMIN.email);
    await page.locator('#password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/admin/, { timeout: 20000 });

    for (const [slug, name] of ADMIN_PAGES) {
      await page.goto(`/admin/${slug}`);
      await page.waitForTimeout(1100);
      await page.screenshot({ path: shot(`${tag}-${name}.png`) });
    }

    /* The mentor-role pages. A different layout, a different nav and a
       narrower scope — and never once reviewed, because signing in as an admin
       never reaches them. */
    await page.context().clearCookies();
    await page.goto('/login');
    await page.locator('#email').fill('e2e-mentor@test.local');
    await page.locator('#password').fill('e2e-mentor-pass-2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/trainer/, { timeout: 20000 }).catch(() => {});
    for (const [slug, name] of [['', 'mentor-dashboard'], ['feedbacks', 'mentor-feedbacks'], ['settings', 'mentor-settings']]) {
      await page.goto(`/trainer/${slug}`);
      await page.waitForTimeout(1000);
      await page.screenshot({ path: shot(`${tag}-${name}.png`) });
    }

    // Student flow: gate, then the form itself.
    await page.context().clearCookies();
    await page.goto(`/feedback/${fx.batchId}`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot(`${tag}-student-gate.png`) });

    /* Through the gate, so the form itself is reviewed — it is the surface
       the most people ever see and the only one a student ever sees. */
    const unlock = await page.request.post(
      `http://localhost:${process.env.E2E_API_PORT || 5051}/api/v1/auth/login`,
      { data: { email: ADMIN.email, password: ADMIN.password } }
    );
    const token = (await unlock.json()).token;
    const opened = await page.request.post(
      `http://localhost:${process.env.E2E_API_PORT || 5051}/api/v1/batches/${fx.batchId}/unlock`,
      { data: { expectedCount: 50 }, headers: { Authorization: `Bearer ${token}` } }
    );
    const passcode = (await opened.json()).passcode;

    await page.goto(`/feedback/${fx.batchId}`);
    await page.getByPlaceholder(/FA2@/i).fill(passcode);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: shot(`${tag}-student-form.png`), fullPage: true });
  });
}
