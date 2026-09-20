'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  DataRow,
  EmptyState,
  InitialsMark,
  SectionHeader,
  StatusLabel,
} from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';

interface NextUpBooking {
  id: string;
  name: string;
  startsAt: string;
  eventTypeName: string;
}

interface Overview {
  upcomingCount: number;
  thisWeekCount: number;
  needsAttentionCount: number;
  last30Days: { started: number; completed: number; meeting: number; other: number };
  nextUp: NextUpBooking[];
  calendarStatus: 'not_connected' | 'active' | 'needs_reconnect' | 'revoked';
}

const CALENDAR_COPY: Record<Overview['calendarStatus'], string> = {
  not_connected: 'Google Calendar isn’t connected',
  active: 'Google Calendar connected',
  needs_reconnect: 'Google Calendar needs reconnecting',
  revoked: 'Google Calendar was disconnected by Google',
};

/** "—" rather than a misleading 0% (or NaN) when nobody has started the
 * questionnaire yet in the window at all — "no signal" and "everyone left"
 * are different facts and shouldn't render the same. */
function completionRate(started: number, completed: number): string {
  if (started === 0) return '—';
  return `${Math.round((completed / started) * 100)}%`;
}

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/* Every figure now looks the same, which is the point.
 *
 * Two of these used to be filled tints — a green one for people who reached
 * the calendar and an amber one for people who did not. It read as a score
 * with a pass and a fail, and amber is this product's warning colour, so a
 * business whose questions were working exactly as intended got a caution
 * tile every time they opened the app. With nobody yet sent down the other
 * path it was worse still: a warning about the number zero.
 *
 * Neither number is good or bad. Someone who found a more useful next step
 * than a meeting is a success for everyone involved — that is the whole
 * argument the product makes — and colouring it as a shortfall contradicts
 * the screen it sits above.
 *
 * So: Mineral numeral, Graphite label, thin border, white. The brief's
 * statistic exactly, and the judgement goes back to the person reading it. */
function BookingLinkBar({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  /* Built in the browser from the address bar rather than from a configured
     base URL, so it is always the host the person is actually on — the one
     they would have copied by hand. */
  const [url, setUrl] = useState('');

  useEffect(() => {
    setUrl(`${window.location.origin}/t/${slug}`);
  }, [slug]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard access can be refused outright — an insecure origin, a
         browser that will not grant it. The link is selectable text either
         way, so the fallback is simply that you copy it yourself. */
    }
  }

  return (
    <div className="booking-link">
      <div className="booking-link-text">
        <p className="admin-eyebrow">Your booking page</p>
        <a href={url || `/t/${slug}`} target="_blank" rel="noreferrer" className="booking-link-url">
          {url || `/t/${slug}`}
        </a>
      </div>
      <div className="booking-link-actions">
        <button type="button" className="btn-secondary" onClick={copy} disabled={!url}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <a className="text-action" href={url || `/t/${slug}`} target="_blank" rel="noreferrer">
          Open
          <span aria-hidden="true" className="text-action-arrow">
            →
          </span>
        </a>
      </div>
      {/* Announced rather than only shown, so the confirmation is not
          carried by a word appearing somewhere a screen reader has left. */}
      <span aria-live="polite" className="sr-only">
        {copied ? 'Booking page link copied to clipboard' : ''}
      </span>
    </div>
  );
}

/* A figure, and where it goes when you press it.
 *
 * A number on a dashboard is only useful if you can get from it to the
 * people it counts. "3 sent somewhere else" is a fact you cannot act on;
 * the three responses, and which answer sent each of them, is a question
 * you can go and fix.
 *
 * It links rather than opening a new view, because the list already exists
 * on the Responses tab with the filters already built — it just could not
 * be addressed from outside. One list to maintain, not two that can
 * disagree about what "sent somewhere else" counts.
 *
 * Figures with nowhere useful to go stay as plain blocks. A link that
 * lands on an unfiltered list is worse than no link: it looks like it did
 * something. */
function Stat({
  label,
  value,
  note,
  href,
}: {
  label: string;
  value: number | string;
  note?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="stat-block-value">{value}</span>
      <span className="stat-block-label">{label}</span>
      {note && <span className="stat-block-period">{note}</span>}
    </>
  );

  if (!href) {
    return (
      <div className="stat-block" style={{ flex: '1 1 150px' }}>
        {body}
      </div>
    );
  }

  return (
    <a className="stat-block stat-block-link" style={{ flex: '1 1 150px' }} href={href}>
      {body}
      <span className="stat-block-more" aria-hidden="true">
        See who →
      </span>
    </a>
  );
}

export default function OverviewPage() {
  const { slug } = useParams<{ slug: string }>();

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await adminFetchJson<Overview>(`/api/admin/${slug}/overview`);
        if (!cancelled) setData(result);
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <>
      <div className="admin-page-head">
        <div>
          <div className="admin-eyebrow">Overview</div>
          <h1>Today</h1>
        </div>
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="status">Loading…</p>}

      {!loading && data && (
        <>
          {data.needsAttentionCount > 0 && (
            <div className="notice notice-error" style={{ marginBottom: 14 }}>
              {data.needsAttentionCount === 1
                ? 'One meeting needs a look'
                : `${data.needsAttentionCount} meetings need a look`}{' '}
              — their calendar sync failed. Check the Meetings page for details.
            </div>
          )}

          {/* Labels in the words a person would use. "Completion rate" and
              "aligned" are report vocabulary; what they mean is how many
              people finished the questions and where those answers sent
              them. The period moves out of the label into its own line, so
              the label is a phrase rather than a phrase with a footnote
              stapled on. */}
          {/* The link the whole product exists to produce.
           *
           * Nothing in the dashboard showed it. A business could set up its
           * services, its hours and its questions, and still have no way to
           * find out what to give people — the URL was only derivable from a
           * slug they chose once, on a form, weeks earlier. On the first
           * screen they open every day, because it is the first thing they
           * need and the thing they will keep coming back for. */}
          <BookingLinkBar slug={slug} />

          <div className="stat-row">
            <Stat label="Upcoming" value={data.upcomingCount} />
            <Stat label="This week" value={data.thisWeekCount} />
            <Stat
              label="Finished the questions"
              value={completionRate(data.last30Days.started, data.last30Days.completed)}
              note="Last 30 days"
              href={`/admin/${slug}/screening/responses`}
            />
            <Stat
              label="Went on to book"
              value={data.last30Days.meeting}
              note="Last 30 days"
              href={`/admin/${slug}/screening/responses?show=meeting`}
            />
            <Stat
              label="Sent somewhere else"
              value={data.last30Days.other}
              note="Last 30 days"
              href={`/admin/${slug}/screening/responses?show=other`}
            />
          </div>

          {/* One sentence does not need a panel with a heading repeating the
              first two words of it. A status line with a dot says the same
              thing in a ninth of the height, and links to the place that
              fixes it rather than naming it. */}
          <p className="calendar-status">
            <StatusLabel tone={data.calendarStatus === 'active' ? 'live' : 'attention'}>
              {CALENDAR_COPY[data.calendarStatus]}
            </StatusLabel>
            {data.calendarStatus !== 'active' && (
              <>
                {' '}
                <a className="text-action" href={`/admin/${slug}/settings`}>
                  Connect it in Settings
                </a>
              </>
            )}
          </p>

          <SectionHeader title="Next up" />
          <section className="surface surface-flush">
            {data.nextUp.length === 0 && (
              <EmptyState
                title="Nothing booked yet"
                description="Appointments appear here as soon as someone picks a time."
              />
            )}
            {data.nextUp.map((b) => (
              /* Every appointment reads the same. The first one used to be
                 bigger, with its time in a filled chip, which made a quiet
                 week look like a page with one important thing and some
                 leftovers. The order already says which is next. */
              <DataRow
                key={b.id}
                lead={<InitialsMark name={b.name} />}
                title={b.name}
                meta={b.eventTypeName}
                trailing={
                  <span className="booking-when">
                    <span>{dayFormat.format(new Date(b.startsAt))}</span>
                    <span className="booking-when-time">
                      {timeFormat.format(new Date(b.startsAt))}
                    </span>
                  </span>
                }
              />
            ))}
          </section>
        </>
      )}
    </>
  );
}
