import { describe, expect, it } from 'vitest';
import { MAX_LOGO_BYTES, checkLogo, sniffLogo } from '../src/lib/logo-file';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0]);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('sniffLogo', () => {
  it('knows PNG, JPEG and WebP by their first bytes', () => {
    expect(sniffLogo(png)).toBe('image/png');
    expect(sniffLogo(jpeg)).toBe('image/jpeg');
    expect(sniffLogo(webp)).toBe('image/webp');
  });
  it('refuses SVG and anything else, whatever it is called', () => {
    expect(sniffLogo(svg)).toBeNull();
    expect(sniffLogo(new TextEncoder().encode('GIF89a'))).toBeNull();
  });
});

describe('checkLogo', () => {
  it('accepts a real image', () => {
    expect(checkLogo(png)).toEqual({ ok: true, type: 'image/png' });
  });
  it('refuses an empty file, an oversized one and the wrong kind', () => {
    expect(checkLogo(new Uint8Array())).toMatchObject({ ok: false });
    const big = new Uint8Array(MAX_LOGO_BYTES + 1);
    big.set(png);
    expect(checkLogo(big)).toMatchObject({ ok: false, message: expect.stringMatching(/1 MB/) });
    expect(checkLogo(svg)).toMatchObject({ ok: false, message: expect.stringMatching(/PNG, JPG or WebP/) });
  });
});
