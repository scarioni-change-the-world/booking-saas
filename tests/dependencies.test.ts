import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Dependency guard for brief 6.1.
 *
 * The `googleapis` package is 114 MB of mostly unused API clients, and on
 * serverless it pushed cold starts past 120 seconds — the booking page appeared
 * to hang. Replacing it with direct fetch calls took node_modules from 114 MB
 * for that one package to 15 MB in total.
 *
 * It is the single easiest mistake to make here: reaching for the official SDK
 * is the obvious move, and the cost does not show up until the thing is
 * deployed. This test makes the regression fail in CI instead.
 */
describe('dependencies', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const all = { ...pkg.dependencies, ...pkg.devDependencies };

  it('does not depend on googleapis', () => {
    expect(Object.keys(all)).not.toContain('googleapis');
  });

  it('does not depend on any google-api SDK wrapper', () => {
    const banned = Object.keys(all).filter(
      (name) => name.startsWith('googleapis') || name.startsWith('@google-cloud/'),
    );
    expect(banned).toEqual([]);
  });

  it('keeps the runtime dependency list small', () => {
    // The reference implementation ran on four runtime dependencies. Adding one
    // should be a decision, not an accident.
    expect(Object.keys(pkg.dependencies ?? {}).length).toBeLessThanOrEqual(8);
  });
});
