import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { ADMIN } from '../seed.mjs';

/**
 * The phase filter, in a real browser.
 *
 * The thing worth testing here is not that the dropdown renders — it is that
 * selecting a phase actually changes what the API is asked for, on every
 * screen, and that "All phases" genuinely means all. A filter that looks
 * applied but is not is worse than no filter: the number on screen is wrong
 * and nothing says so.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(HERE, '..', '.fixtures.json'), 'utf8'));

async function signIn(page) {
  await page.goto('/login');
  await page.locator('#email').fill(ADMIN.email);
  await page.locator('#password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
}

const filter = (page) => page.getByLabel('Filter by collection phase');

/* The options arrive with the phase list, one request after sign-in. Reading
   them immediately is a race — the select exists before it is populated. */
async function readyFilter(page) {
  const sel = filter(page);
  await expect(sel).toBeVisible();
  await expect(sel.locator('option')).not.toHaveCount(1);
  return sel;
}

test.describe.serial('phase filter', () => {
  test('appears in the workspace bar with "All phases" selected first', async ({ page }) => {
    await signIn(page);
    await expect(filter(page)).toBeVisible();
    // The default must be every phase — a dashboard that opens pre-filtered
    // lies by omission to anyone who does not notice.
    await expect(filter(page)).toHaveValue('all');
    const first = await filter(page).locator('option').first().textContent();
    expect(first).toMatch(/all phases/i);
  });

  test('lists every phase that exists', async ({ page }) => {
    await signIn(page);
    const options = await (await readyFilter(page)).locator('option').allTextContents();
    expect(options[0]).toMatch(/all phases/i);
    expect(options.some((o) => /Phase 1/.test(o))).toBe(true);
  });

  test('selecting a phase sends it to the API', async ({ page }) => {
    await signIn(page);
    const value = await (await readyFilter(page)).locator('option').nth(1).getAttribute('value');

    const call = page.waitForRequest(
      (r) => /\/dashboard\/admin/.test(r.url()) && r.url().includes(`phase=${value}`)
    );
    await filter(page).selectOption(value);
    await call; // resolves only if the parameter was actually sent
  });

  test('switching back to All phases DROPS the parameter entirely', async ({ page }) => {
    /* Not `phase=all` — the server would reject that as an invalid id. The
       parameter has to be absent. */
    await signIn(page);
    const value = await (await readyFilter(page)).locator('option').nth(1).getAttribute('value');
    await filter(page).selectOption(value);
    await page.waitForTimeout(600);

    const call = page.waitForRequest((r) => /\/dashboard\/admin/.test(r.url()));
    await filter(page).selectOption('all');
    const req = await call;
    expect(req.url()).not.toContain('phase=');
  });

  test('the choice survives navigation', async ({ page }) => {
    // An admin who narrows to a phase and opens another screen is still
    // thinking about that phase.
    await signIn(page);
    const value = await (await readyFilter(page)).locator('option').nth(1).getAttribute('value');
    await filter(page).selectOption(value);
    await page.waitForTimeout(400);

    await page.goto('/admin/feedbacks');
    await expect(filter(page)).toHaveValue(value);
  });

  test('it is hidden where it could not apply', async ({ page }) => {
    /* A filter that cannot affect anything on screen is noise, and worse, it
       implies the page IS filtered when it is not. */
    await signIn(page);
    await page.goto('/admin/settings');
    await expect(filter(page)).toHaveCount(0);
    await page.goto('/admin/parameters');
    await expect(filter(page)).toHaveCount(0);
  });

  test('the student flow never sees it, and never asks for phases', async ({ page }) => {
    const calls = [];
    page.on('request', (r) => { if (r.url().includes('/phases')) calls.push(r.url()); });
    await page.goto(`/feedback/${fx.batchId}`);
    await page.waitForTimeout(800);
    await expect(filter(page)).toHaveCount(0);
    expect(calls).toHaveLength(0);
  });
});
