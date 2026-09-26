/**
 * What counts as a logo file: a real PNG, JPEG or WebP under 1 MB, judged by
 * its first bytes rather than by the name or type the browser claims. The
 * bucket (migration 0031) enforces the same three types and size again.
 */

export const MAX_LOGO_BYTES = 1024 * 1024;

export type LogoType = 'image/png' | 'image/jpeg' | 'image/webp';

export const LOGO_EXTENSION: Record<LogoType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const starts = (bytes: Uint8Array, sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);

export function sniffLogo(bytes: Uint8Array): LogoType | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // "RIFF" ···· "WEBP"
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

export type LogoCheck = { ok: true; type: LogoType } | { ok: false; message: string };

export function checkLogo(bytes: Uint8Array): LogoCheck {
  if (bytes.length === 0) return { ok: false, message: 'That file is empty.' };
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, message: 'Logos can be up to 1 MB. Try a smaller export.' };
  const type = sniffLogo(bytes);
  if (!type) return { ok: false, message: 'Use a PNG, JPG or WebP image.' };
  return { ok: true, type };
}
