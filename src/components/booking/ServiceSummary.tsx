'use client';

import { articleFor } from './journey';
import { formatMoney } from '@/lib/money';
import { describeLocation } from '@/lib/service-location';
import type { PublicConfig, PublicEventType } from '../types';

/**
 * What you are booking.
 *
 * The one part of the screen that does not change as the journey moves: a
 * client four steps into a form should never have to scroll back to check
 * what they are booking. Its facts are read the way the admin reads a
 * figure — a small label, then the value — and once a time is chosen it
 * appears underneath, on a stone panel.
 *
 * Who it is with is the nameplate in the bar above (ClientShell), or, framed
 * in the business's own website, that website.
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
  if (!config || !eventType) return null;

  const location = describeLocation(eventType.locationKind, eventType.locationDetail);

  return (
    <div className="bk-summary">
      <div className="bk-service">
        <h2 className="bk-service-name">{eventType.name}</h2>
        {eventType.description && <p className="bk-service-note">{eventType.description}</p>}
        <dl className="bk-facts">
          <div>
            <dt>Length</dt>
            <dd>{eventType.durationMinutes} minutes</dd>
          </div>
          {location && (
            <div>
              <dt>Where</dt>
              <dd>{location}</dd>
            </div>
          )}
          {/* Nothing at all when no price is set. An unset price is not
              free, and "€0.00" would say it was. */}
          {eventType.priceMinor !== null && (
            <div>
              <dt>Price</dt>
              <dd className="bk-price">
                {formatMoney(eventType.priceMinor, config.currency)}
                {eventType.bookingMode === 'pack' ? ' per session' : ''}
              </dd>
            </div>
          )}
          {eventType.bookingMode === 'pack' && eventType.packSize && (
            <div>
              <dt>Package</dt>
              <dd>
                Part of {articleFor(eventType.packSize)} {eventType.packSize}-session package
              </dd>
            </div>
          )}
        </dl>
      </div>

      {slot && (
        <div className="bk-chosen">
          <p className="bk-chosen-label">Your time</p>
          <p className="bk-chosen-when">{formatInstantDay(slot)}</p>
          <p className="bk-chosen-time">{formatTimeRange(slot, eventType.durationMinutes)}</p>
          <p className="bk-chosen-zone">{viewerZone}</p>
        </div>
      )}
    </div>
  );
}
