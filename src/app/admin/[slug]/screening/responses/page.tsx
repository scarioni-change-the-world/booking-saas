'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';

type PathType = 'meeting' | 'other';
type Status = 'meeting' | 'other' | 'in-progress';

interface AnsweredQuestion {
  questionId: string;
  prompt: string;
  answer: string;
}

interface ResponseItem {
  id: string;
  email: string | null;
  startedAt: string;
  completedAt: string | null;
  outcomePathType: PathType | null;
  answers: AnsweredQuestion[];
}

interface Funnel {
  started: number;
  completed: number;
  meeting: number;
  other: number;
}

const FILTERS: { key: 'all' | Status; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'meeting', label: 'Aligned' },
  { key: 'other', label: 'Other path' },
  { key: 'in-progress', label: 'In progress' },
];

const STATUS_LABEL: Record<Status, string> = {
  meeting: 'Aligned',
  other: 'Other path',
  'in-progress': 'In progress',
};

function statusOf(r: ResponseItem): Status {
  if (!r.completedAt) return 'in-progress';
  return r.outcomePathType === 'other' ? 'other' : 'meeting';
}

/** First letter of the email's local part — a response has no name yet,
 * only an email, so that's what marks its row (brief: same job the
 * reference's photo-less lettered avatars do). */
function avatarLetter(email: string | null): string {
  return (email ?? '?').trim().charAt(0).toUpperCase() || '?';
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function relativeTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  if (Math.abs(diffMin) < 60) return relativeFormat.format(diffMin, 'minute');
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return relativeFormat.format(diffHr, 'hour');
  const diffDay = Math.round(diffHr / 24);
  return relativeFormat.format(diffDay, 'day');
}

export default function ResponsesPage() {
  const { slug } = useParams<{ slug: string }>();

  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [responses, setResponses] = useState<ResponseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [funnelResult, responsesResult] = await Promise.all([
          adminFetchJson<Funnel>(`/api/admin/${slug}/funnel`),
          adminFetchJson<{ responses: ResponseItem[] }>(`/api/admin/${slug}/responses`),
        ]);
        if (cancelled) return;
        setFunnel(funnelResult);
        setResponses(responsesResult.responses);
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

  const inProgress = funnel ? funnel.started - funnel.completed : 0;

  const filtered = useMemo(
    () => (filter === 'all' ? responses : responses.filter((r) => statusOf(r) === filter)),
    [responses, filter],
  );

  return (
    <div>
      <div className="admin-card-title">How intake is performing · 30 days</div>
      <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '-6px 0 18px', maxWidth: 620 }}>
        These questions are what turns a visitor into a meeting — a low completion rate, or a lot
        of people stuck in progress, usually means there are too many questions or one is asked in
        a way that makes people leave.
      </p>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="status">Loading…</p>}

      {!loading && funnel && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
            <div className="card admin-tile" style={{ flex: '1 1 130px' }}>
              <div className="admin-tile-value">{funnel.started}</div>
              <div className="admin-tile-label">Started</div>
            </div>
            <div className="card admin-tile tone-live" style={{ flex: '1 1 130px' }}>
              <div className="admin-tile-value">{funnel.meeting}</div>
              <div className="admin-tile-label">Aligned</div>
            </div>
            <div className="card admin-tile tone-attention" style={{ flex: '1 1 130px' }}>
              <div className="admin-tile-value">{funnel.other}</div>
              <div className="admin-tile-label">Other path</div>
            </div>
            <div className="card admin-tile" style={{ flex: '1 1 130px' }}>
              <div className="admin-tile-value">{inProgress}</div>
              <div className="admin-tile-label">In progress</div>
            </div>
          </div>

          {responses.length === 0 ? (
            <p className="notice notice-muted">Nobody has started the questionnaire yet in the last 30 days.</p>
          ) : (
            <>
              <div className="filter-chip-row">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={`filter-chip${filter === f.key ? ' active' : ''}`}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="admin-list">
                {filtered.map((r) => {
                  const status = statusOf(r);
                  const expanded = expandedId === r.id;
                  return (
                    <div key={r.id} className="card admin-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : r.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 14,
                          width: '100%',
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          textAlign: 'left',
                          font: 'inherit',
                          color: 'inherit',
                        }}
                        aria-expanded={expanded}
                      >
                        <div className="response-avatar">{avatarLetter(r.email)}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{r.email ?? 'No email recorded'}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--faint)' }}>
                            Started {relativeTime(r.startedAt)}
                          </div>
                        </div>
                        <span className={`response-status-pill ${status}`}>{STATUS_LABEL[status]}</span>
                      </button>

                      {expanded && (
                        <div className="response-answers">
                          {r.answers.length === 0 ? (
                            <p className="preview-empty" style={{ margin: 0 }}>
                              {status === 'in-progress'
                                ? 'No answers recorded yet — they left before finishing.'
                                : 'No answers recorded for this response.'}
                            </p>
                          ) : (
                            r.answers.map((a) => (
                              <div key={a.questionId}>
                                <div className="response-answer-prompt">{a.prompt}</div>
                                <div className="response-answer-value">{a.answer}</div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
