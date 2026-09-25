import { monogram, serviceColour } from '@/lib/service-identity';

/**
 * A service's mark, drawn as a knob: its two letters in its colour, in a
 * ring on a small white plate — the way a Braun control carries its label.
 * Always beside the name, never instead of it, so it is hidden from screen
 * readers — it would only repeat the name as initials.
 *
 * `off` draws the ring dashed: a service nobody can book yet.
 */
export function ServiceBadge({
  name,
  color,
  size = 'md',
  off = false,
}: {
  name: string;
  color: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  off?: boolean;
}) {
  return (
    <span
      className={`svc-badge svc-badge-${size}${off ? ' is-off' : ''}`}
      style={{ ['--svc' as string]: serviceColour(color) }}
      aria-hidden="true"
    >
      <span className="svc-badge-ring">{monogram(name)}</span>
    </span>
  );
}
