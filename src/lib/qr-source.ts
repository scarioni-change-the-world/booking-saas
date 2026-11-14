/**
 * Supabase hands the QR code over as an SVG in a data address, with the
 * markup left raw. A raw "#" in it (a colour) reads as the start of a URL
 * fragment and cuts the image off, so the markup is re-encoded.
 */
export function qrSource(qr: string): string {
  const raw = /^data:image\/svg\+xml;[^,]*,(<[\s\S]*)$/i.exec(qr)?.[1];
  if (raw) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`;
  if (qr.trim().startsWith('<svg')) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.trim())}`;
  return qr;
}
