import { test, expect } from '@playwright/test';
import { SHARED, ADMIN } from '../seed.mjs';

/**
 * One login, two institutions.
 *
 * Covered by API tests on one side and component tests on the other, and
 * still worth running for real: the failure this guards against lives exactly
 * between them — a header that never reaches the server, a picker that cannot
 * be reached because reaching it needs the very choice it exists to make, a
 * redirect that loops. All of those pass a unit test on either side.
 */
test.describe('a mentor who works at two institutions', () => {
  test('is asked which one, rather than being dropped into either', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(SHARED.email);
    await page.locator('#password').fill(SHARED.password);
    await page.getByRole('button', { name: /sign in/i }).click();

    /* No default. Opening into whichever sorted first would put one college's
       figures on screen under a heading that does not name it. */
    await expect(page).toHaveURL(/\/choose-organization/);
    await expect(page.getByRole('heading', { name: /choose an organization/i })).toBeVisible();
    await expect(page.getByText('E2E Institute')).toBeVisible();
    await expect(page.getByText('Second Institute')).toBeVisible();
  });

  test('can enter one of them and see its feedback', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(SHARED.email);
    await page.locator('#password').fill(SHARED.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/choose-organization/);

    await page.getByRole('button', { name: /E2E Institute/ }).click();
    await expect(page).toHaveURL(/\/trainer/);
  });

  test('clicking a college STAYS there — it does not bounce back to the picker', async ({ page }) => {
    /* The reported bug. Choosing is immediately followed by navigating, and
       React runs effects children-first, so the page being navigated into
       fetched before the header was applied — the server asked for a choice
       and the client returned the person to the question they had just
       answered. Only a real browser exercises that ordering. */
    await page.goto('/login');
    await page.locator('#email').fill(SHARED.email);
    await page.locator('#password').fill(SHARED.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/choose-organization/);

    await page.getByRole('button', { name: /E2E Institute/ }).click();
    await expect(page).toHaveURL(/\/trainer/);

    /* Settle, then assert it did not drift back. A bounce took a moment:
       request, refusal, redirect. */
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/trainer/);
    await expect(page.getByRole('heading', { name: /choose an organization/i })).toHaveCount(0);
  });

  test('and the second college works the same way', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(SHARED.email);
    await page.locator('#password').fill(SHARED.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('button', { name: /Second Institute/ }).click();
    await expect(page).toHaveURL(/\/trainer/);
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/trainer/);
  });

  test('somebody who works at ONE institution never sees the picker', async ({ page }) => {
    /* Ceremony for the common case would be the wrong trade. */
    await page.goto('/login');
    await page.locator('#email').fill(ADMIN.email);
    await page.locator('#password').fill(ADMIN.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin/);
  });
});
