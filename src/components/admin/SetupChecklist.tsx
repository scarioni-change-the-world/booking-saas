'use client';

import { useEffect, useState } from 'react';
import { setupOpen, type SetupItem } from '@/lib/setup';

/**
 * "Get ready to take bookings": what is left before people can book, in
 * order, each with the place to do it. The finish line a new business
 * otherwise has to guess at.
 *
 * Same marks as a service's setup (✓ done, ! needed, + optional), so the
 * two lists read alike. It stays until everything is done; hiding it folds
 * it to one line with the count, never away entirely, so nobody hides it
 * on day one and then wonders what they missed.
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
  const key = `khloe-setup-folded:${slug}`;
  const [folded, setFolded] = useState(false);

  useEffect(() => {
    try {
      setFolded(window.localStorage.getItem(key) === '1');
    } catch {
      /* No storage (a private window): it simply starts open. */
    }
  }, [key]);

  function fold(next: boolean) {
    setFolded(next);
    try {
      if (next) window.localStorage.setItem(key, '1');
      else window.localStorage.removeItem(key);
    } catch {
      /* Folding still works for this visit. */
    }
  }

  if (!setupOpen(items)) return null;
  const done = items.filter((i) => i.state === 'done').length;
  const needed = items.filter((i) => i.state === 'needed').length;

  if (folded) {
    return (
      <p className="gs-folded">
        <span>
          <b>Getting ready</b> · {done} of {items.length} done
          {needed > 0 && <span className="gs-folded-needed"> · {needed} needed</span>}
        </span>
        <button type="button" className="btn-link" onClick={() => fold(false)}>
          Show
        </button>
      </p>
    );
  }

  return (
    <section className="card gs" aria-labelledby="gs-title">
      <div className="gs-head">
        <div>
          <h2 className="gs-title" id="gs-title">
            {needed > 0 ? 'Get ready to take bookings' : 'Nearly there'}
          </h2>
          <p className="gs-count">
            {done} of {items.length} done
          </p>
        </div>
        <button type="button" className="btn-link" onClick={() => fold(true)}>
          Hide
        </button>
      </div>
      <div className="gs-bar" aria-hidden="true">
        {items.map((i, n) => (
          <span key={i.id} className={n < done ? 'is-done' : ''} />
        ))}
      </div>

      <ol className="setup-stages gs-list">
        {items.map((item) => {
          const tone = item.state === 'done' ? 'is-done' : item.state === 'needed' ? 'is-blocking' : 'is-loose';
          return (
            <li key={item.id} className={`setup-stage ${tone}`}>
              <div className="setup-stage-head">
                <span className="setup-stage-n" aria-hidden="true">
                  {item.state === 'done' ? '✓' : item.state === 'needed' ? '!' : '+'}
                </span>
                <div className="setup-stage-main">
                  <p className="setup-stage-label">
                    {item.title}
                    {item.state !== 'done' && (
                      <span className={`setup-stage-tag${item.state === 'needed' ? ' is-needed' : ''}`}>
                        {item.state === 'needed' ? 'Needed' : 'Optional'}
                      </span>
                    )}
                    <span className="sr-only">{item.state === 'done' ? ' (done)' : ''}</span>
                  </p>
                  <p className="setup-stage-purpose">{item.detail}</p>
                </div>
                {item.action && (
                  <div className="setup-stage-action">
                    {item.action.href === 'add-service' ? (
                      <button type="button" className="btn-secondary" onClick={onAddService}>
                        {item.action.label}
                      </button>
                    ) : (
                      <a className="btn-secondary" href={`/admin/${slug}/${item.action.href}`}>
                        {item.action.label}
                      </a>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
