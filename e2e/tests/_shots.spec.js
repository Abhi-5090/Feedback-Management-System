import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { ADMIN } from '../seed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(HERE, '..', '.fixtures.json'), 'utf8'));
const shot = (p) => join(HERE, '..', 'shots', p);

test('capture', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.screenshot({ path: shot('01-login.png') });

  await page.locator('#email').fill(ADMIN.email);
  await page.locator('#password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/admin/, { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot('02-dashboard.png'), fullPage: false });

  for (const [slug, file] of [['batches','03-batches'],['trainers','04-mentors'],['classes','05-classes'],['parameters','06-parameters']]) {
    await page.goto(`/admin/${slug}`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: shot(`${file}.png`) });
  }

  // Student gate
  await page.context().clearCookies();
  await page.goto(`/feedback/${fx.batchId}`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('07-student-gate.png') });
});
