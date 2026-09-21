'use client';

import { articleFor } from './journey';
import { initials } from '../brand';
import type { PublicConfig, PublicEventType } from '../types';

/**
 * Who you are booking with, and what.
 *
 * The one part of the screen that does not change as the journey moves. That
 * is its whole job: a client four steps into a form should never have to
 * scroll back to check whose calendar they are on. It answers the first two
 * of the four questions a stranger has in the first five seconds — who, and
 * what — and, once a time is chosen, the third.
 *
 * The business is the identity here. intro appears once, small, at the foot
 * of the standalone shell, and nowhere near this.
 */

export function ServiceSummary({
  config,
  eventType,
  slot,
  viewerZone,
  formatInstantDay,
  formatTimeRange,
}: {
  config: PublicConfig | null;
  eventType: PublicEventType | null;
  slot: string | null;
  viewerZone: string;
  formatInstantDay: (iso: string) => string;
  formatTimeRange: (iso: string, durationMinutes: number) => string;
}) {
  if (!config) return null;

  return (
    <div className="bk-summary">
      <div className="bk-identity">
        <div className="bk-avatar">
          {config.branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied, arbitrary remote host
            <img src={config.branding.logoUrl} alt="" />
          ) : (
            initials(config.name)
          )}
        </div>
        {/* A plain name in the body face. Deliberately not the wordmark
            treatment — the business's name imitating intro's logo would be
            this product wearing its customer's identity. */}
        <p className="bk-business">{config.name}</p>
      </div>

      {eventType && (
        <div className="bk-service">
          <h2 className="bk-service-name">{eventType.name}</h2>
          {eventType.description && (
            <p className="bk-service-note">{eventType.description}</p>
          )}
          <ul className="bk-facts">
            <li>{eventType.durationMinutes} minutes</li>
            {eventType.bookingMode === 'pack' && eventType.packSize && (
              <li>
                Part of {articleFor(eventType.packSize)} {eventType.packSize}-session package
              </li>
            )}
          </ul>
        </div>
      )}

      {slot && eventType && (
        <div className="bk-chosen">
          <p className="bk-chosen-label">Your time</p>
          <p className="bk-chosen-when">{formatInstantDay(slot)}</p>
          <p className="bk-chosen-time">
            {formatTimeRange(slot, eventType.durationMinutes)}
          </p>
          <p className="bk-chosen-zone">{viewerZone}</p>
        </div>
      )}
    </div>
  );
}
