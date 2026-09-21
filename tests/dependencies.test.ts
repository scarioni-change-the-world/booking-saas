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

/**
 * Server code must not reach the browser bundle.
 *
 * The trap, which cost a build: a small helper in src/lib gets imported by a
 * client component for one pure function, and that helper imports
 * BookingError for its validation half — which pulls in booking-service,
 * then the database client, then node:net. Turbopack's failure names a
 * chunking context and a missing external module, not the import that did
 * it, so the diagnosis is a search rather than a read.
 *
 * The rule this encodes is the shape that fixed it: a module the browser
 * loads may hold display logic, but request parsing belongs beside the
 * routes that do the parsing. See service-location.ts and the parseLocation
 * that lives in admin-event-types.ts instead.
 *
 * Type-only imports are exempt because they are erased before anything is
 * bundled.
 */
describe('client bundle', () => {
  const root = new URL('../src/', import.meta.url);

  /** Runtime imports only — `import type { X } from` is erased. */
  function runtimeImports(source: string): string[] {
    const found: string[] = [];
    const pattern = /^\s*import\s+(?!type\s)([^;]*?)\s*from\s*'([^']+)'/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      // `import { type A, b }` still imports b at runtime; `import { type A }`
      // alone does not, but treating it as a runtime import is the safe
      // direction to be wrong in.
      found.push(match[2]!);
    }
    return found;
  }

  function filesUnder(dir: URL): string[] {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = new URL(entry, dir);
      if (statSync(path).isDirectory()) out.push(...filesUnder(new URL(`${entry}/`, dir)));
      else if (/\.tsx?$/.test(entry)) out.push(path.pathname);
    }
    return out;
  }

  /** The src/lib modules that client components pull in at runtime. */
  const libsReachedFromComponents = new Set<string>();
  for (const file of filesUnder(new URL('components/', root))) {
    for (const specifier of runtimeImports(readFileSync(file, 'utf8'))) {
      const lib = /^@\/lib\/(.+)$/.exec(specifier)?.[1];
      if (lib) libsReachedFromComponents.add(lib);
    }
  }

  /** What such a module must never import at runtime. */
  const SERVER_ONLY = ['./booking-service', './db', './db/client', './email', 'node:'];

  it('finds the lib modules the browser actually loads', () => {
    // A guard on the guard: if this ever comes back empty the assertions
    // below pass by looking at nothing.
    expect(libsReachedFromComponents.size).toBeGreaterThan(0);
  });

  it('keeps server-only modules out of anything a client component imports', () => {
    const offenders: string[] = [];

    for (const lib of libsReachedFromComponents) {
      let source: string;
      try {
        source = readFileSync(new URL(`lib/${lib}.ts`, root), 'utf8');
      } catch {
        continue; // a directory index or a .tsx; not the shape this guards
      }

      for (const specifier of runtimeImports(source)) {
        if (SERVER_ONLY.some((banned) => specifier.startsWith(banned))) {
          offenders.push(`@/lib/${lib} imports ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
