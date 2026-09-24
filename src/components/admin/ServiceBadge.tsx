import { monogram, serviceColour } from '@/lib/service-identity';

/**
 * A service's mark: its two letters on its colour. Always beside the name,
 * never instead of it, so it is hidden from screen readers — it would only
 * repeat the name as initials.
 */
export function ServiceBadge({
  name,
  color,
  size = 'md',
}: {
  name: string;
  color: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className={`svc-badge svc-badge-${size}`} style={{ background: serviceColour(color) }} aria-hidden="true">
      {monogram(name)}
    </span>
  );
}
