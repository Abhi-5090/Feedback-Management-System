import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { ADMIN } from '../seed.mjs';

/**
 * The student submission flow, in a real browser.
 *
 * This is the one path in the product where a failure cannot be retried — a
 * cohort gets one sitting. It is also the path the API and component suites
 * cannot cover, because what breaks here are browser facts: a first-party
 * cookie that does not survive the hop, a device lock keyed on something the
 * browser reports differently, a one-shot session token consumed twice by an
 * impatient double click.
 *
 * The flow is driven end to end. The admin signs in and unlocks the batch
 * through the UI, and the student then uses the passcode that produced —
 * because the handoff between those two halves is itself part of what can
 * break.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(HERE, '..', '.fixtures.json'), 'utf8'));
const BATCH_URL = `/feedback/${fixtures.batchId}`;

/* Captured by the admin test and used by the student tests. Module scope
   because it genuinely is shared state: the passcode only exists once it has
   been generated, and generating it twice would invalidate the first. */
let passcode = null;

async function signInAsAdmin(page) {
  await page.goto('/login');
  await page.locator('#email').fill(ADMIN.email);
  await page.locator('#password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
}

/** Rate every parameter of every subject and write each comment. */
async function completeTheForm(page, comment) {
  const groups = page.getByRole('radiogroup');
  await expect(groups.first()).toBeVisible();
  const count = await groups.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await groups.nth(i).getByRole('radio', { name: /^4 stars/ }).click();
  }
  const comments = page.getByPlaceholder(/what went well/i);
  const n = await comments.count();
  for (let i = 0; i < n; i++) {
    // The server requires at least 10 characters.
    await comments.nth(i).fill(`${comment} — subject ${i + 1}, plenty long enough.`);
  }
}

test.describe.serial('student submission', () => {
  test('an admin unlocks the batch and is shown the passcode', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/batches');
    await expect(page.getByText(fixtures.batchName)).toBeVisible();

    /* Read the passcode from the app's OWN response rather than scraping the
       rendered modal. The generated alphabet includes punctuation (a real one
       looks like "EC2@MDFC!P4PK"), so a text regex is a guess that breaks the
       day the generator changes. Watching the response is exact. */
    const unlockResponse = page.waitForResponse(
      (r) => /\/api\/batches\/[^/]+\/unlock$/.test(r.url()) && r.request().method() === 'POST'
    );

    await page.getByRole('button', { name: /unlock and generate a passcode/i }).first().click();
    /* Scoped by accessible name. Both modals carry role="dialog" and the
       unlock one is still animating out as the reveal animates in, so a bare
       getByRole('dialog') is ambiguous for a few hundred milliseconds. */
    const unlockDialog = page.getByRole('dialog', { name: /^unlock/i });
    await expect(unlockDialog).toBeVisible();
    await unlockDialog.getByRole('button', { name: /unlock & generate/i }).click();

    const body = await (await unlockResponse).json();
    passcode = body.passcode;
    expect(passcode, 'the unlock response carried no passcode').toBeTruthy();

    // And it is actually shown to the admin — a passcode generated but never
    // displayed is a batch nobody can open. It is revealed exactly once.
    const reveal = page.getByRole('dialog', { name: /passcode/i });
    await expect(reveal).toBeVisible();
    await expect(reveal).toContainText(passcode);
  });

  test('a wrong passcode is refused and the form stays shut', async ({ page }) => {
    await page.goto(BATCH_URL);
    await page.getByPlaceholder(/FA2@/i).fill('NOT@THEPASSCODE');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText(/passcode|incorrect|invalid/i).first()).toBeVisible();
    // Still on the gate: no rating control has been rendered.
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
  });

  test('the right passcode opens the form, and a submission is accepted', async ({ page }) => {
    expect(passcode, 'the unlock test must run first').toBeTruthy();

    await page.goto(BATCH_URL);
    await page.getByPlaceholder(/FA2@/i).fill(passcode);
    await page.getByRole('button', { name: 'Continue' }).click();

    /* Both subjects must be rateable. A single-subject batch would not catch
       the real bug class here: the submission is one transaction across every
       class in the batch. */
    const groups = page.getByRole('radiogroup');
    await expect(groups.first()).toBeVisible({ timeout: 15_000 });
    expect(await groups.count()).toBe(fixtures.classIds.length * fixtures.parameterCount);

    await completeTheForm(page, 'The pace was good and the examples helped');

    const submitted = page.waitForResponse(
      (r) => r.url().endsWith('/api/public/feedback') && r.request().method() === 'POST'
    );
    await page.getByRole('button', { name: /submit feedback/i }).click();
    expect((await submitted).status()).toBe(201);

    await expect(page.getByText(/thank/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('a device that has submitted cannot submit again', async ({ page }) => {
    /* The guarantee the product is sold on, and the one that cannot be tested
       without a browser: the device lock rides on an httpOnly first-party
       cookie set during verify-passcode.

       BOTH attempts happen in this one test on purpose. Playwright gives every
       test a fresh browser context — a new cookie jar — so splitting them
       across two tests proves nothing about the same device, and an earlier
       draft of this file passed while testing exactly nothing. */
    const submitOnce = async (comment) => {
      await page.goto(BATCH_URL);
      await page.getByPlaceholder(/FA2@/i).fill(passcode);
      await page.getByRole('button', { name: 'Continue' }).click();

      const gate = page.getByText(/already|recorded|thank/i).first();
      const form = page.getByRole('radiogroup').first();
      await expect(form.or(gate)).toBeVisible({ timeout: 15_000 });

      // The gate may refuse before the form ever opens — that is a pass.
      if (!(await form.isVisible().catch(() => false))) return null;

      await completeTheForm(page, comment);
      const response = page.waitForResponse((r) => r.url().endsWith('/api/public/feedback'));
      await page.getByRole('button', { name: /submit feedback/i }).click();
      return (await response).status();
    };

    const first = await submitOnce('First submission from this device');
    expect(first, 'the first submission should have been accepted').toBe(201);
    await expect(page.getByText(/thank/i).first()).toBeVisible({ timeout: 15_000 });

    const second = await submitOnce('A second attempt from the same device');
    // Either refused at the gate (null — the form never opened) or rejected by
    // the server. What must never happen is a second 201.
    expect(second).not.toBe(201);
    await expect(page.getByText(/already|recorded|thank/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('a DIFFERENT device may still submit', async ({ browser }) => {
    // A fresh context is a fresh browser: no cookie, so no device lock.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(BATCH_URL);
      await page.getByPlaceholder(/FA2@/i).fill(passcode);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('radiogroup').first()).toBeVisible({ timeout: 15_000 });

      await completeTheForm(page, 'A different student on a different device');
      const submitted = page.waitForResponse((r) => r.url().endsWith('/api/public/feedback'));
      await page.getByRole('button', { name: /submit feedback/i }).click();
      expect((await submitted).status()).toBe(201);
    } finally {
      await context.close();
    }
  });
});
