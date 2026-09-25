'use client';

import { useServiceMark } from '@/components/admin/ServiceMarks';

/**
 * A service's mark, drawn as a knob: its two letters in a ring on a small
 * white plate — the way a Braun control carries its label. No colour: in
 * the admin, colour is kept for what needs you (Ochre) and where you are
 * (Mineral), so services are told apart by their letters, which no two
 * services share (see uniqueMonograms), and by their names.
 * Always beside the name, never instead of it, so it is hidden from screen
 * readers — it would only repeat the name as initials.
 *
 * `off` draws the ring dashed: a service nobody can book yet.
 */
export function ServiceBadge({
  name,
  size = 'md',
  off = false,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  off?: boolean;
}) {
  const mark = useServiceMark();
  return (
    <span className={`svc-badge svc-badge-${size}${off ? ' is-off' : ''}`} aria-hidden="true">
      <span className="svc-badge-ring">{mark(name)}</span>
    </span>
  );
}
