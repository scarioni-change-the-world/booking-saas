'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
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
  last30Days: { qualified: number; redirected: number };
  nextUp: NextUpBooking[];
  calendarStatus: 'not_connected' | 'active' | 'needs_reconnect' | 'revoked';
}

const CALENDAR_COPY: Record<Overview['calendarStatus'], string> = {
  not_connected: 'Google Calendar isn’t connected',
  active: 'Google Calendar connected',
  needs_reconnect: 'Google Calendar needs reconnecting',
  revoked: 'Google Calendar was disconnected by Google',
};

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'live' | 'attention' }) {
  const color = tone === 'live' ? 'var(--status-live-ink)' : tone === 'attention' ? 'var(--status-attention-ink)' : 'var(--ink)';
  return (
    <div className="card" style={{ flex: '1 1 140px' }}>
      <div style={{ fontSize: '1.9rem', fontWeight: 500, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 2 }}>{label}</div>
    </div>
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

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
            <Tile label="Upcoming" value={data.upcomingCount} />
            <Tile label="This week" value={data.thisWeekCount} />
            <Tile label="Aligned · 30 days" value={data.last30Days.qualified} tone="live" />
            <Tile label="Other path · 30 days" value={data.last30Days.redirected} tone="attention" />
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="admin-card-title">Google Calendar</div>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
              {CALENDAR_COPY[data.calendarStatus]}
              {data.calendarStatus !== 'active' && ' — manage this from Settings.'}
            </p>
          </div>

          <div className="card">
            <div className="admin-card-title">Next up</div>
            {data.nextUp.length === 0 && (
              <p className="notice notice-muted" style={{ margin: 0 }}>
                Nothing on the calendar yet.
              </p>
            )}
            {data.nextUp.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.nextUp.map((b, i) => (
                  <div
                    key={b.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 12,
                      paddingBottom: i === data.nextUp.length - 1 ? 0 : 12,
                      borderBottom: i === data.nextUp.length - 1 ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.95rem' }}>{b.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--faint)' }}>{b.eventTypeName}</div>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--muted)', textAlign: 'right' }}>
                      {dayFormat.format(new Date(b.startsAt))}
                      <br />
                      {timeFormat.format(new Date(b.startsAt))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
