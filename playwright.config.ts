import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests for the booking flow (brief 9.3).
 *
 * These require a running app against a database seeded with
 * supabase/seed.sql — they are not unit tests and will fail without one. The
 * pure logic that can be tested without a database lives in tests/ and runs
 * under Vitest.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
      },
});
