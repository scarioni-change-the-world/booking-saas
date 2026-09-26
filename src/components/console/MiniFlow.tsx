import type { MiniFlow as MiniFlowModel } from '@/lib/tenant-health';

/**
 * A business's flow, five parts long, for the Console.
 *
 * The same shapes the business sees on its own Flow: a filled dot that
 * works, a dashed one that is thin, a hollow Ochre one that stops bookings,
 * and a line cut from the first break onwards. Every dot carries its words
 * for a screen reader and on hover, so nothing rests on colour.
 */
export function MiniFlow({ flow }: { flow: MiniFlowModel }) {
  return (
    <ol className="mf" aria-label={flow.parts.map((p) => `${p.label}: ${p.note}`).join('. ')}>
      {flow.parts.map((p, i) => (
        <li
          key={p.id}
          className={`mf-part is-${p.state}${i > 0 && !flow.links[i - 1] ? ' is-cut' : ''}`}
          title={p.note}
        >
          <i aria-hidden="true" />
          <span aria-hidden="true">{p.label}</span>
        </li>
      ))}
    </ol>
  );
}
