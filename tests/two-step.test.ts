import { describe, expect, it } from 'vitest';
import { tokenAal } from '../src/lib/auth';

const token = (payload: object) =>
  `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

describe('tokenAal', () => {
  it('reads the second step from a signed-in token', () => {
    expect(tokenAal(token({ sub: 'u', aal: 'aal2' }))).toBe('aal2');
    expect(tokenAal(token({ sub: 'u', aal: 'aal1' }))).toBe('aal1');
  });

  it('treats anything unreadable as one step only', () => {
    expect(tokenAal(token({ sub: 'u' }))).toBe('aal1');
    expect(tokenAal('not-a-token')).toBe('aal1');
    expect(tokenAal('a.%%%.c')).toBe('aal1');
  });
});

describe('qrSource', () => {
  it('re-encodes a raw SVG so a "#" cannot cut it off', async () => {
    const { qrSource } = await import('../src/lib/qr-source');
    const raw = 'data:image/svg+xml;utf-8,<svg fill="#000"></svg>';
    const out = qrSource(raw);
    expect(out.startsWith('data:image/svg+xml;charset=utf-8,%3Csvg')).toBe(true);
    expect(out).not.toContain('#');
    expect(qrSource('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });
});
