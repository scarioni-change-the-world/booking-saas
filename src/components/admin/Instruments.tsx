/**
 * The few instruments the app reads out with, after Braun's: a lamp that
 * says a state, a dial that shows a share, a grille of dots, one for each
 * person, and a slide scale that sets a value. Each is drawn from a number and a
 * sentence; the drawing is never the only place the number is said.
 */

/** Where a fraction of the way round the top half of a circle lands. */
function onArc(fraction: number, radius: number, cx = 60, cy = 60) {
  const f = Math.min(1, Math.max(0, fraction));
  return {
    x: +(cx - radius * Math.cos(f * Math.PI)).toFixed(2),
    y: +(cy - radius * Math.sin(f * Math.PI)).toFixed(2),
  };
}

export type LampTone = 'live' | 'need' | 'here' | 'off';

/**
 * A small indicator light: on (Granite), needs you (Ochre), you are here
 * (Mineral), or off (a ring).
 */
export function Lamp({ tone = 'live' }: { tone?: LampTone }) {
  return <span className={`lamp is-${tone}`} aria-hidden="true" />;
}

/**
 * A share as a semicircle filling up — "24 of 28 finished". The label is
 * the accessible name; the figure inside repeats it for the eye.
 */
export function Dial({ part, whole, label }: { part: number; whole: number; label: string }) {
  const end = onArc(whole > 0 ? part / whole : 0, 50);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => [onArc(f, 44), onArc(f, 40)] as const);
  return (
    <svg className="dial" viewBox="0 0 120 68" role="img" aria-label={label}>
      <path d="M10 60 A50 50 0 0 1 110 60" className="dial-track" />
      {part > 0 && whole > 0 && <path d={`M10 60 A50 50 0 0 1 ${end.x} ${end.y}`} className="dial-fill" />}
      <path d={ticks.map(([a, b]) => `M${a.x} ${a.y} L${b.x} ${b.y}`).join(' ')} className="dial-ticks" />
      <text x="60" y="58" textAnchor="middle" className="dial-text">
        {part}/{whole}
      </text>
    </svg>
  );
}

/**
 * One dot for each person, lit for the ones who got there. Drawn only
 * while the dots can still be counted by eye; past that it is noise.
 */
export const GRILLE_MAX = 60;

export function Grille({ lit, of, label }: { lit: number; of: number; label: string }) {
  if (of <= 0 || of > GRILLE_MAX) return null;
  return (
    <span className="grille" role="img" aria-label={label}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < lit ? 'is-on' : undefined} />
      ))}
    </span>
  );
}

/**
 * A setting on a slide scale: its stops down the side, the slider resting
 * on the one in use. It is the control, not a picture of one — choosing a
 * stop (or moving with the arrow keys) sets it — so it never promises a
 * slide it cannot do. The stops must include the current value.
 */
export function SlideScale({
  stops,
  current,
  label,
  onChoose,
  disabled = false,
}: {
  stops: Array<{ value: number; label: string }>;
  current: number;
  label: string;
  onChoose: (value: number) => void;
  disabled?: boolean;
}) {
  const at = stops.findIndex((s) => s.value === current);

  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = stops[Math.min(stops.length - 1, Math.max(0, at + step))];
    if (next && next.value !== current) onChoose(next.value);
  }

  return (
    <span className="scale" style={{ ['--stops' as string]: stops.length, ['--at' as string]: at }}>
      <span className="scale-track" aria-hidden="true">
        <span className="scale-thumb" />
      </span>
      <span className="scale-stops" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
        {stops.map((s, i) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={i === at}
            tabIndex={i === at ? 0 : -1}
            className={i === at ? 'is-on' : undefined}
            disabled={disabled}
            onClick={() => s.value !== current && onChoose(s.value)}
          >
            {s.label}
          </button>
        ))}
      </span>
    </span>
  );
}
