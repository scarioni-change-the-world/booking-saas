'use client';

import { useEffect, useState } from 'react';
import { DATES_PER_PAGE, pageContaining, pageCount, pageSlice } from './slots';
import type { DaySlots } from '../types';

/**
 * Choosing a day.
 *
 * Replaces a horizontally scrolling strip. The strip's defect was not that
 * it looked dated — it was that dates ran off the edge of the screen with
 * nothing to say so, on exactly the devices where a horizontal scroll is
 * least discoverable. A client who could not see next Tuesday concluded
 * there was no next Tuesday.
 *
 * So: a fixed page of dates, and two arrows that say plainly there is more.
 * Nothing is ever cut off, the arrows disable at the ends rather than
 * wrapping, and the whole thing is buttons in document order, so it works
 * from the keyboard with no key handling of its own.
 */
export function DateNavigator({
  days,
  selectedDate,
  onSelect,
  dowFormat,
}: {
  days: DaySlots[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
  dowFormat: Intl.DateTimeFormat;
}) {
  const total = pageCount(days);
  const [page, setPage] = useState(() => pageContaining(days, selectedDate));

  // Follow the selection when it lands on another page — which happens when
  // availability loads and picks the first day that actually has openings.
  useEffect(() => {
    setPage(pageContaining(days, selectedDate));
  }, [days, selectedDate]);

  if (total === 0) return null;

  const visible = pageSlice(days, page);
  const first = visible[0];
  const last = visible[visible.length - 1];

  /* "1 – 7 March" over the arrows, so the page has a name and moving between
     pages is a change you can see rather than infer from the numbers. */
  const rangeFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' });
  const rangeLabel =
    first && last
      ? `${rangeFormat.format(new Date(`${first.date}T12:00:00`))} – ${rangeFormat.format(
          new Date(`${last.date}T12:00:00`),
        )}`
      : '';

  return (
    <div className="bk-dates">
      <div className="bk-dates-head">
        <button
          type="button"
          className="bk-arrow"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          aria-label="Earlier dates"
        >
          <span aria-hidden="true">←</span>
        </button>
        <p className="bk-dates-range">{rangeLabel}</p>
        <button
          type="button"
          className="bk-arrow"
          onClick={() => setPage((p) => Math.min(total - 1, p + 1))}
          disabled={page >= total - 1}
          aria-label="Later dates"
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="bk-date-row">
        {visible.map((day) => {
          const date = new Date(`${day.date}T12:00:00`);
          const open = day.slots.length > 0;
          const active = day.date === selectedDate;

          return (
            <button
              key={day.date}
              type="button"
              className={`bk-date${active ? ' is-active' : ''}${open ? '' : ' is-empty'}`}
              disabled={!open}
              aria-pressed={active}
              onClick={() => onSelect(day.date)}
            >
              <span className="bk-date-dow">{dowFormat.format(date)}</span>
              <span className="bk-date-num">{date.getDate()}</span>
              {/* Said in words for anyone who cannot see the dimming. */}
              {!open && <span className="sr-only">No times available</span>}
            </button>
          );
        })}
        {/* Keeps a short last page the same width as a full one, so the row
            does not resize as you page through. */}
        {Array.from({ length: DATES_PER_PAGE - visible.length }, (_, i) => (
          <span key={`pad-${i}`} className="bk-date-pad" aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}
