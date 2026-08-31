import { expect, test } from '@playwright/test';

/**
 * The qualification gate and its outcome paths, end to end.
 *
 * Requires the demo tenant from supabase/seed.sql.
 */
const TENANT = 'demo-coaching';

test.describe('prospect flow', () => {
  test('shows every question on one page, not stepwise', async ({ page }) => {
    // An explicit product decision after testing — stepwise felt like an
    // interrogation (brief 2.2). Email comes first, on its own — see the
    // next test — but the questions themselves stay all-at-once.
    await page.goto(`/t/${TENANT}`);
    await page.getByLabel('Email').fill('prospect@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('What would you most like to change')).toBeVisible();
    await expect(page.getByText('Have you worked with a coach before?')).toBeVisible();
    await expect(page.getByText('What are you able to invest')).toBeVisible();
  });

  test('asks for email before any question, so a drop-off is still visible', async ({ page }) => {
    // migration 0012: a response row (and therefore a completion rate) now
    // exists from the moment someone gives their email, not only for those
    // who finish.
    await page.goto(`/t/${TENANT}`);
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByText('What would you most like to change')).toBeHidden();
  });

  test('does not reveal the calendar before the questions are answered', async ({ page }) => {
    await page.goto(`/t/${TENANT}`);
    await expect(page.getByRole('heading', { name: 'Pick a time' })).toBeHidden();
  });

  test('an answer sent down the other path never reaches the calendar', async ({ page }) => {
    await page.goto(`/t/${TENANT}`);
    await page.getByLabel('Email').fill('redirected@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByRole('textbox').first().fill('More clients');
    // exact: true throughout. Playwright matches accessible names as
    // case-insensitive substrings, so a bare name: 'No' also matches
    // "I can't afford this right now" — "now" contains "no" — and the locator
    // fails as ambiguous rather than clicking the wrong thing.
    await page.getByRole('radio', { name: 'Yes', exact: true }).check();
    await page
      .getByRole('radio', { name: "I can't afford this right now", exact: true })
      .check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('not the right fit right now')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get the free guide' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pick a time' })).toBeHidden();
  });

  test('an answer on the meeting path books a discovery call', async ({ page }) => {
    await page.goto(`/t/${TENANT}`);
    await page.getByLabel('Email').fill('ana@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByRole('textbox').first().fill('More clients');
    await page.getByRole('radio', { name: 'No', exact: true }).check();
    await page.getByRole('radio', { name: 'Over 2.000 €', exact: true }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Only one event type is available to prospects, so the picker auto-skips.
    await expect(page.getByRole('heading', { name: 'Pick a time' })).toBeVisible();

    await page.locator('.slot').first().click();
    await page.getByLabel('Name').fill('Ana Test');
    // Pre-filled from the email step above — confirm it carried over rather
    // than asking again from blank, and leave it as-is.
    await expect(page.getByLabel('Email')).toHaveValue('ana@example.com');
    await page.getByRole('button', { name: 'Confirm booking' }).click();

    await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();
    await expect(page.getByRole('link', { name: 'manage your booking' })).toBeVisible();
  });

  test('the API refuses a booking without a response on the meeting path', async ({ request }) => {
    // The gate must hold at the endpoint, not only in the widget.
    const response = await request.post(`/api/t/${TENANT}/bookings`, {
      data: {
        eventTypeId: '00000000-0000-4000-8000-000000000002',
        startsAt: '2027-01-04T09:00:00.000Z',
        name: 'Mallory',
        email: 'mallory@example.com',
      },
    });
    expect(response.status()).toBe(403);
  });

  test('the availability endpoint refuses a caller not on the meeting path', async ({ request }) => {
    const response = await request.get(
      `/api/t/${TENANT}/availability?eventTypeId=00000000-0000-4000-8000-000000000002`,
    );
    expect(response.status()).toBe(403);
  });

  test('the public questions never carry the outcome-path flags', async ({ request }) => {
    const response = await request.get(`/api/t/${TENANT}/questions`);
    expect(await response.text()).not.toContain('outcomePathType');
  });
});

test.describe('existing-client flow', () => {
  test('goes straight to the calendar with no questionnaire', async ({ page }) => {
    await page.goto(`/t/${TENANT}/client`);
    await expect(page.getByRole('heading', { name: 'Pick a time' })).toBeVisible();
    await expect(page.getByText('What are you able to invest')).toBeHidden();
  });
});
