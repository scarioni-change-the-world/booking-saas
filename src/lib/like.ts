/**
 * A value as a case-insensitive LIKE pattern that matches only itself.
 *
 * Email addresses are matched with ilike so that "Maya@Example.com" and
 * "maya@example.com" are one person. But in a LIKE pattern "_" means any
 * one character and "%" any run of them, and addresses are full of
 * underscores: unescaped, a_b@x.com also matches axb@x.com — so one
 * person's booking could be filed under somebody else's client record, and
 * that record's private link emailed to the wrong person.
 */
export function exactPattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
