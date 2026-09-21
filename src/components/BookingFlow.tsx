'use client';

import { useEffect, useState } from 'react';
import { BookingExperience } from './booking/BookingExperience';
import { ServiceSummary } from './booking/ServiceSummary';
import { useBookingJourney } from './booking/useBookingJourney';
import { useHostHeight } from './booking/useHostHeight';
import { accentStyle } from './brand';

/**
 * The booking experience, in whichever of its two forms applies.
 *
 * One journey, two shells. The shells differ in what surrounds the booking,
 * never in the booking itself: standalone puts it on a page of its own, with
 * the business's identity beside it and a discreet credit at the foot;
 * embedded strips all of that away and lets the host page's own background,
 * width and margins show through, so it reads as part of that site rather
 * than as a second website trapped inside it.
 *
 * Prospects pass through the qualification gate before any time is shown
 * (brief 2.1). An existing client never comes through here at all — their
 * own private, per-client link (ClientBooking, .../client/[token]) skips the
 * gate and identifies who they are, which this has no way to do for an
 * anonymous visitor.
 */

export type BookingMode = 'standalone' | 'embedded';

interface Props {
  slug: string;
  /**
   * Which shell to render. Left unset, the component works it out from
   * whether it is in a frame.
   *
   * The prop wins when given, because detection cannot see intent: a
   * customer may want the standalone page inside a frame (a modal on their
   * own site, say), and a `?mode=` on the URL is how they ask for that.
   * Detection is the default, not the rule.
   */
  mode?: BookingMode;
}

export default function BookingFlow({ slug, mode }: Props) {
  const journey = useBookingJourney(slug);
  useHostHeight();

  /**
   * Framed or not — resolved after mount, never during render.
   *
   * `window.parent !== window` is not knowable on the server, so reading it
   * while rendering would produce one tree on the server and another in the
   * browser: a hydration mismatch, and a visible flash of the wrong shell.
   * Standalone is the first paint because it is the one that is right when
   * somebody opens the link directly, which is the case where a flash would
   * actually be seen.
   */
  const [framed, setFramed] = useState(false);
  useEffect(() => {
    setFramed(window.parent !== window);
  }, []);

  const resolved: BookingMode = mode ?? (framed ? 'embedded' : 'standalone');
  const accent = accentStyle(journey.config?.branding.accentColor);

  const summary = (
    <ServiceSummary
      config={journey.config}
      eventType={journey.eventType}
      /* Dropped once the booking exists: the confirmation states the time
         far more clearly than a sidebar note, and two places showing the
         same fact is two places that can disagree. */
      slot={journey.phase === 'confirmed' ? null : journey.slot}
      viewerZone={journey.viewerZone}
      formatInstantDay={(iso) =>
        new Intl.DateTimeFormat(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        }).format(new Date(iso))
      }
      formatTimeRange={(iso, minutes) => {
        const format = new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        });
        const start = new Date(iso);
        return `${format.format(start)} – ${format.format(
          new Date(start.getTime() + minutes * 60_000),
        )}`;
      }}
    />
  );

  if (resolved === 'embedded') {
    return (
      /* No page background, no outer margins, no credit, no two columns.
         The host page supplies all of that, and anything added here reads as
         a box somebody dropped into their layout.
         
         The identity moves *inside* the panel rather than sitting above it.
         Framed, there is no page for a header to sit on — a name floating
         above the panel would be flush against the iframe's own edge, which
         is the one thing that gives an embed away. */
      <div className="bk bk-embedded" style={accent}>
        <div className="bk-panel">
          {summary}
          <BookingExperience journey={journey} />
        </div>
      </div>
    );
  }

  return (
    <div className="bk bk-standalone" style={accent}>
      <main className="bk-page">
        <div className="bk-columns">
          <aside className="bk-aside-col">{summary}</aside>
          <div className="bk-panel">
            <BookingExperience journey={journey} />
          </div>
        </div>

        {/* The only place intro speaks on this page, and it speaks quietly.
            Lowercase always; the wordmark treatment is reserved for here and
            never lent to the business's own name above. */}
        <p className="bk-credit">
          Powered by <span className="bk-wordmark">intro</span>
        </p>
      </main>
    </div>
  );
}
