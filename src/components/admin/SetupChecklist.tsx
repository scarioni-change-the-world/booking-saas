'use client';

import { useEffect, useState } from 'react';
import { setupOpen, type SetupItem } from '@/lib/setup';

/**
 * "Getting ready": what is left before people can book, as one line.
 *
 * The page it sits on is about the business's services, so this never
 * takes the page over: one line with how far along it is and only the
 * next thing to do, with its button. "See all" opens the whole list, each
 * item on one line (done ones a tick). It is gone once everything is done.
 *
 * The step-by-step setup is offered inside it, and is the one Ochre key on
 * the page only while something is actually needed.
 */
export function SetupChecklist({
  slug,
  items,
  onAddService,
}: {
  slug: string;
  items: SetupItem[];
  onAddService: () => void;
}) {
  const key = `khloe-setup-open:${slug}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(key) === '1');
    } catch {
      /* No storage: it starts closed. */
    }
  }, [key]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      if (next) window.localStorage.setItem(key, '1');
      else window.localStorage.removeItem(key);
    } catch {
      /* Still toggles for this visit. */
    }
  }

  if (!setupOpen(items)) return null;
  const done = items.filter((i) => i.state === 'done').length;
  const needed = items.some((i) => i.state === 'needed');
  // The next thing: the first needed item, else the first optional one.
  const nextItem = items.find((i) => i.state === 'needed') ?? items.find((i) => i.state !== 'done')!;

  const action = (item: SetupItem, emphasis = false) =>
    item.action &&
    (item.action.href === 'add-service' ? (
      <button type="button" className={`btn-secondary${emphasis ? ' is-need' : ''}`} onClick={onAddService}>
        {item.action.label}
      </button>
    ) : (
      <a className={`btn-secondary${emphasis ? ' is-need' : ''}`} href={`/admin/${slug}/${item.action.href}`}>
        {item.action.label}
      </a>
    ));

  return (
    <section className={`gs2${open ? ' is-open' : ''}`} aria-label="Getting ready to take bookings">
      <div className="gs2-line">
        <span className={`gs2-lamp${needed ? ' is-need' : ''}`} aria-hidden="true" />
        <p className="gs2-progress">
          <b>Getting ready</b> · {done} of {items.length}
        </p>
        <p className="gs2-next">
          <span className="gs2-next-label">Next:</span> {nextItem.title}
        </p>
        <div className="gs2-keys">
          {action(nextItem, nextItem.state === 'needed')}
          <button type="button" className="btn-link" aria-expanded={open} onClick={toggle}>
            {open ? 'Close' : 'See all'}
          </button>
        </div>
      </div>

      {open && (
        <>
          <ol className="gs2-list">
            {items.map((item) => (
              <li key={item.id} className={`gs2-item is-${item.state}`}>
                <span className="gs2-mark" aria-hidden="true">
                  {item.state === 'done' ? '✓' : item.state === 'needed' ? '!' : '+'}
                </span>
                <span className="gs2-text">
                  <b>{item.title}</b>
                  {item.state !== 'done' && <small>{item.detail}</small>}
                  <span className="sr-only">
                    {item.state === 'done' ? ' (done)' : item.state === 'needed' ? ' (needed)' : ' (optional)'}
                  </span>
                </span>
                {item.state !== 'done' && item !== nextItem && item.action && (
                  item.action.href === 'add-service' ? (
                    <button type="button" className="btn-link" onClick={onAddService}>
                      {item.action.label}
                    </button>
                  ) : (
                    <a className="btn-link" href={`/admin/${slug}/${item.action.href}`}>
                      {item.action.label}
                    </a>
                  )
                )}
              </li>
            ))}
          </ol>
          <p className="gs2-guided">
            Prefer to be walked through it?{' '}
            {/* Plain: the line's next step is the one Ochre key. */}
            <a className="btn-secondary" href={`/admin/${slug}/start`}>
              Start step-by-step setup
            </a>
          </p>
        </>
      )}
    </section>
  );
}
