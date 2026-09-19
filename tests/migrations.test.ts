import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS } from '@/lib/db/migrations';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/**
 * The list in src/lib/db/migrations.ts is what /api/health compares the
 * database against, and it is maintained by hand because a serverless bundle
 * cannot read this directory at runtime. These tests are what stop that hand
 * from slipping: add a migration without registering it and the suite fails
 * here, long before a deployment quietly stops checking it.
 */
describe('EXPECTED_MIGRATIONS', () => {
  it('lists exactly the files in supabase/migrations, in the same order', () => {
    const onDisk = migrationFiles().map((name) => name.replace(/\.sql$/, ''));
    expect([...EXPECTED_MIGRATIONS]).toEqual(onDisk);
  });

  it('is sorted, so "later file" and "later migration" mean the same thing', () => {
    const sorted = [...EXPECTED_MIGRATIONS].sort();
    expect([...EXPECTED_MIGRATIONS]).toEqual(sorted);
  });

  it('has no duplicates', () => {
    expect(new Set(EXPECTED_MIGRATIONS).size).toBe(EXPECTED_MIGRATIONS.length);
  });

  it('numbers every migration uniquely and without gaps', () => {
    const numbers = EXPECTED_MIGRATIONS.map((v) => Number(v.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });
});

/**
 * Every migration from 0022 on records itself, which is the whole basis of
 * the check. A file that skips the line leaves the database reporting a
 * migration as outstanding for ever, so /api/health would show a permanent
 * false alarm and stop being believed — the failure mode that kills a
 * warning light.
 */
describe('self-recording', () => {
  const TRACKED_FROM = 22;

  const tracked = migrationFiles().filter((name) => Number(name.slice(0, 4)) >= TRACKED_FROM);

  it('covers at least the migration that introduced the tracking table', () => {
    expect(tracked.length).toBeGreaterThan(0);
  });

  for (const file of tracked) {
    const version = file.replace(/\.sql$/, '');

    it(`${version} inserts its own version into schema_migrations`, () => {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

      // Comments explain the mechanism at length in 0022; only a real
      // statement counts, so strip line comments before looking.
      const statements = sql
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n');

      expect(statements).toMatch(/insert\s+into\s+schema_migrations/i);
      expect(statements).toContain(`'${version}'`);
    });
  }
});
