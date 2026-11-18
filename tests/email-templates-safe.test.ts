import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('email templates in the browser', () => {
  it('stay plain data: nothing imported at runtime', () => {
    const source = readFileSync(new URL('../src/lib/email/templates.ts', import.meta.url), 'utf8');
    const runtime = [...source.matchAll(/^\s*import\s+(?!type\s)[^;]*from\s*'([^']+)'/gm)].map((m) => m[1]);
    expect(runtime).toEqual([]);
  });
});
