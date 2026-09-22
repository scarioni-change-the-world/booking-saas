'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';
import { ReconsideredMark } from '@/components/admin/ReconsideredMark';
import type { Reconsideration } from '@/lib/reconsideration';

type PathType = 'meeting' | 'other';
type Status = 'meeting' | 'other' | 'in-progress';

interface AnsweredQuestion {
  questionId: string;
  prompt: string;
  answer: string;
  /* Which way this particular answer pointed. Stored on every answer since
     migration 0011 and never surfaced — so a business could see that someone
     was sent elsewhere but not which answer did it, which is the only part
     they can act on. Null for free text, which never routes anyone. */
  outcomePathType: PathType | null;
}

interface ResponseItem {
  id: string;
  email: string | null;
  reconsidered: Reconsideration | null;
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

/* "Aligned" and "Other path" survived the vocabulary sweep by being in an
   array of labels rather than in markup. Same words the Overview figures
   use, so a figure and the list it opens agree. */
const FILTERS: { key: 'all' | Status; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'meeting', label: 'Went on to book' },
  { key: 'other', label: 'Sent somewhere else' },
  { key: 'in-progress', label: 'Still answering' },
];

const STATUS_LABEL: Record<Status, string> = {
  meeting: 'Went on to book',
  other: 'Sent somewhere else',
  'in-progress': 'Still answering',
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
  /* Seeded from the URL so a figure on Overview can open this list already
     narrowed. Read once on mount rather than tracked: after that the chips
     own it, and rewriting the address bar on every chip click would put a
     dozen dead entries in the back button between here and Overview. */
  const search = useSearchParams();
  const requested = search.get('show');
  const [filter, setFilter] = useState<'all' | Status>(
    requested === 'meeting' || requested === 'other' || requested === 'in-progress'
      ? requested
      : 'all',
  );
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
          {/* Same four figures, told plainly and without a verdict attached.
              "Aligned" in a green tile and "Other path" in an amber one
              framed one outcome as the good one and the other as a problem,
              which is the opposite of what this product argues: a person
              who found a better next step than a meeting was helped. */}
          <div className="stat-row">
            <div className="stat-block" style={{ flex: '1 1 140px' }}>
              <span className="stat-block-value">{funnel.started}</span>
              <span className="stat-block-label">Started answering</span>
            </div>
            <div className="stat-block" style={{ flex: '1 1 140px' }}>
              <span className="stat-block-value">{funnel.meeting}</span>
              <span className="stat-block-label">Went on to book</span>
            </div>
            <div className="stat-block" style={{ flex: '1 1 140px' }}>
              <span className="stat-block-value">{funnel.other}</span>
              <span className="stat-block-label">Sent somewhere else</span>
            </div>
            <div className="stat-block" style={{ flex: '1 1 140px' }}>
              <span className="stat-block-value">{inProgress}</span>
              <span className="stat-block-label">Still answering</span>
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

                      {/* Outside the toggle button, not inside it: this is a
                          disclosure of its own, and nesting one interactive
                          control in another makes both harder to operate
                          from a keyboard. */}
                      {r.reconsidered && <ReconsideredMark reconsidered={r.reconsidered} />}

                      {expanded && (
                        <div className="response-answers">
                          {r.answers.length === 0 ? (
                            <p className="preview-empty" style={{ margin: 0 }}>
                              {status === 'in-progress'
                                ? 'No answers recorded yet — they left before finishing.'
                                : 'No answers recorded for this response.'}
                            </p>
                          ) : (
                            r.answers.map((a) => {
                              /* The answer that did it. Without this a
                                 business can see that somebody was sent
                                 elsewhere and has no way to know which
                                 question is doing the filtering — which is
                                 the only thing they can actually change. */
                              const routed = a.outcomePathType === 'other';
                              return (
                                <div key={a.questionId} className={routed ? 'response-answer-routed' : undefined}>
                                  <div className="response-answer-prompt">{a.prompt}</div>
                                  <div className="response-answer-value">{a.answer}</div>
                                  {routed && (
                                    <div className="response-answer-note">
                                      This answer led to another next step
                                    </div>
                                  )}
                                </div>
                              );
                            })
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
