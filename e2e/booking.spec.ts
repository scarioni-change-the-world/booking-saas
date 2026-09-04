import { expect, test, type Page } from '@playwright/test';

/**
 * The qualification gate and its outcome paths, end to end.
 *
 * Requires the demo tenant from supabase/seed.sql.
 */
const TENANT = 'demo-coaching';

/**
 * Picks "Discovery call" from the type picker — now the first step for
 * every prospect (migration 0016: which service is being booked decides
 * which questions apply, so it has to be known before the gate can run).
 * The demo has two prospect-facing services, so this no longer auto-skips
 * the way it did with only one.
 */
async function chooseDiscovery(page: Page) {
  await expect(page.getByRole('heading', { name: 'Choose a session' })).toBeVisible();
  await page.getByRole('button', { name: 'Discovery call' }).click();
}

test.describe('prospect flow', () => {
  test('shows every question on one page, not stepwise', async ({ page }) => {
    // An explicit product decision after testing — stepwise felt like an
    // interrogation (brief 2.2). Email comes first, on its own — see the
    // next test — but the questions themselves stay all-at-once.
    await page.goto(`/t/${TENANT}`);
    await chooseDiscovery(page);
    await page.getByLabel('Email').fill('prospect@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('What would you most like to change')).toBeVisible();
    await expect(page.getByText('Have you worked with a coach before?')).toBeVisible();
    await expect(page.getByText('What are you able to invest')).toBeVisible();
    // Strategy session's own question (migration 0016) has no business here.
    await expect(page.getByText('single biggest obstacle')).toBeHidden();
  });

  test('asks for email before any question, so a drop-off is still visible', async ({ page }) => {
    // migration 0012: a response row (and therefore a completion rate) now
    // exists from the moment someone gives their email, not only for those
    // who finish.
    await page.goto(`/t/${TENANT}`);
    await chooseDiscovery(page);
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByText('What would you most like to change')).toBeHidden();
  });

  test('does not reveal the calendar before the questions are answered', async ({ page }) => {
    await page.goto(`/t/${TENANT}`);
    await expect(page.getByRole('heading', { name: 'Pick a time' })).toBeHidden();
  });

  test('an answer sent down the other path never reaches the calendar', async ({ page }) => {
    await page.goto(`/t/${TENANT}`);
    await chooseDiscovery(page);
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
    await chooseDiscovery(page);
    await page.getByLabel('Email').fill('ana@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByRole('textbox').first().fill('More clients');
    await page.getByRole('radio', { name: 'No', exact: true }).check();
    await page.getByRole('radio', { name: 'Over 2.000 €', exact: true }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    // The service was already chosen before the gate ran (migration 0016) —
    // straight to its calendar, no second service pick.
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

test.describe('multi-service scoping (migration 0016)', () => {
  // The demo has two prospect-facing services (see supabase/seed.sql) so
  // the type picker — and per-service questions — are actually exercised
  // rather than always auto-skipping the way a single-service tenant does.

  test('the type picker shows every prospect-facing service', async ({ page }) => {
    await page.goto(`/t/${TENANT}`);
    await expect(page.getByRole('heading', { name: 'Choose a session' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Discovery call' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Strategy session' })).toBeVisible();
  });

  test('a service-specific question only appears for its own service', async ({ page }) => {
    await page.goto(`/t/${TENANT}`);
    await page.getByRole('button', { name: 'Strategy session' }).click();
    await page.getByLabel('Email').fill('strategist@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Strategy's own question, alongside the three shared ones every
    // prospect-facing service asks.
    await expect(page.getByText("single biggest obstacle")).toBeVisible();
    await expect(page.getByText('What would you most like to change')).toBeVisible();
    await expect(page.getByText('Have you worked with a coach before?')).toBeVisible();
  });

  test("switching services re-checks the new service's own gate", async ({ page }) => {
    await page.goto(`/t/${TENANT}`);
    await chooseDiscovery(page);
    await page.getByLabel('Email').fill('switcher@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByRole('textbox').first().fill('More clients');
    await page.getByRole('radio', { name: 'No', exact: true }).check();
    await page.getByRole('radio', { name: 'Over 2.000 €', exact: true }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Pick a time' })).toBeVisible();

    // Switch to the other prospect-facing service, from the calendar step.
    await page.getByRole('button', { name: 'Choose a different session' }).click();
    await page.getByRole('button', { name: 'Strategy session' }).click();

    // Back at the gate rather than straight to Strategy's calendar: it has
    // a question of its own that hasn't been answered yet, even though
    // Discovery's gate was already cleared. Email carried over.
    await expect(page.getByLabel('Email')).toHaveValue('switcher@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();

    // The shared answers already given for Discovery carry straight over —
    // not asked twice.
    await expect(page.getByRole('textbox').first()).toHaveValue('More clients');
    await expect(page.getByRole('radio', { name: 'No', exact: true })).toBeChecked();
    // Strategy's own question is new and still needs an answer.
    await expect(page.getByText("single biggest obstacle")).toBeVisible();
    await page.getByRole('textbox').last().fill('Finding the time');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Pick a time' })).toBeVisible();
  });
});

test.describe('existing-client flow', () => {
  test('goes straight to the calendar with no questionnaire', async ({ page }) => {
    await page.goto(`/t/${TENANT}/client`);
    await expect(page.getByRole('heading', { name: 'Pick a time' })).toBeVisible();
    await expect(page.getByText('What are you able to invest')).toBeHidden();
  });
});
