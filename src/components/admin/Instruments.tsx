/**
 * The few instruments the app reads out with, after Braun's: a lamp that
 * says a state, a dial that shows a share, a gauge with a needle, and a
 * grille of dots, one for each person. Each is drawn from a number and a
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
 * A small indicator light: on (Ink), needs you (Ochre), you are here
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

/** A needle across a scale from nothing to `max` — the week's booked hours. */
export function Gauge({ value, max, unit, label }: { value: number; max: number; unit: string; label: string }) {
  const tip = onArc(max > 0 ? value / max : 0, 42);
  const ticks = [0, 1, 2, 3, 4, 5, 6].map((i) => [onArc(i / 6, 46), onArc(i / 6, 40)] as const);
  return (
    <svg className="gauge" viewBox="0 0 120 68" role="img" aria-label={label}>
      <path d="M10 60 A50 50 0 0 1 110 60" className="gauge-track" />
      <path d={ticks.map(([a, b]) => `M${a.x} ${a.y} L${b.x} ${b.y}`).join(' ')} className="gauge-ticks" />
      <line x1="60" y1="60" x2={tip.x} y2={tip.y} className="gauge-needle" />
      <circle cx="60" cy="60" r="3.2" className="gauge-hub" />
      <text x="10" y="67" className="gauge-end">
        0
      </text>
      <text x="110" y="67" textAnchor="end" className="gauge-end">
        {max} {unit}
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
 * A setting read off a slide scale: its stops down the side, the slider
 * resting on the one in use. A read-out, not a control — the sentence
 * beside it says the same, and changing it is its own form. The stops
 * must include the current value.
 */
export function SlideScale({ stops, current }: { stops: Array<{ value: number; label: string }>; current: number }) {
  const at = stops.findIndex((s) => s.value === current);
  const all = stops;
  return (
    <span className="scale" aria-hidden="true" style={{ ['--stops' as string]: all.length, ['--at' as string]: at }}>
      <span className="scale-track">
        <span className="scale-thumb" />
      </span>
      <span className="scale-stops">
        {all.map((s, i) => (
          <span key={s.value} className={i === at ? 'is-on' : undefined}>
            {s.label}
          </span>
        ))}
      </span>
    </span>
  );
}
