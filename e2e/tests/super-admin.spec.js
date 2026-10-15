import { test, expect } from '@playwright/test';
import { SUPER } from '../seed.mjs';

/**
 * The super admin flow, in a real browser.
 *
 * Covered by unit tests on both sides — the API creates organizations, the
 * page renders them — and still worth running for real, because the failure
 * this guards against lives exactly between them: a tenant header that never
 * reaches the server, a route the build does not have, a page that renders an
 * empty list because the call it made was refused. All of those pass a unit
 * test on either side and produce a screen with nothing on it.
 */
async function signInAsRoot(page) {
  await page.goto('/login');
  await page.locator('#email').fill(SUPER.email);
  await page.locator('#password').fill(SUPER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  // A super admin belongs to no organization, so they land on the platform.
  await expect(page).toHaveURL(/\/platform/);
}

test.describe('super admin', () => {
  test('lands on the platform and SEES the existing organization', async ({ page }) => {
    await signInAsRoot(page);
    await expect(page.getByRole('heading', { name: 'Organizations', exact: true })).toBeVisible();
    /* The actual complaint was an empty list. Asserting the row is present is
       the whole point of this test. */
    await expect(page.getByText('E2E Institute')).toBeVisible();
  });

  test('creates a second organization with a chosen password', async ({ page }) => {
    await signInAsRoot(page);
    await page.getByRole('button', { name: /new organization/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.locator('#org-name').fill('Created Institute');
    await dialog.locator('#admin-name').fill('Created Admin');
    await dialog.locator('#admin-email').fill('created-admin@test.local');
    await dialog.locator('#new-org-password').fill('Harbour-Lantern-42');
    await dialog.getByRole('button', { name: /create organization/i }).click();

    // The confirmation, then the row in the list.
    await expect(page.getByText(/organization created/i)).toBeVisible();
    await page.getByRole('button', { name: /^done$/i }).click();
    await expect(page.getByText('Created Institute')).toBeVisible();
  });

  test('the new admin can sign in and reach their own workspace', async ({ page }) => {
    await signInAsRoot(page);
    await page.getByRole('button', { name: /new organization/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#org-name').fill('Third Institute');
    await dialog.locator('#admin-name').fill('Third Admin');
    await dialog.locator('#admin-email').fill('third-admin@test.local');
    await dialog.locator('#new-org-password').fill('Harbour-Lantern-42');
    // Straight in, rather than through the change-password screen.
    await dialog.getByRole('checkbox').uncheck();
    await dialog.getByRole('button', { name: /create organization/i }).click();
    await expect(page.getByText(/organization created/i)).toBeVisible();

    await page.context().clearCookies();
    await page.goto('/login');
    await page.locator('#email').fill('third-admin@test.local');
    await page.locator('#password').fill('Harbour-Lantern-42');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin/);
  });

  test('switching organization moves into that workspace', async ({ page }) => {
    await signInAsRoot(page);
    await page.getByRole('button', { name: /Organization:/ }).click();
    await page.getByRole('option', { name: /E2E Institute/ }).click();
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole('button', { name: /Organization: E2E Institute/ })).toBeVisible();
  });
});
