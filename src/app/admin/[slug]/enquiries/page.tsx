'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';
import { PageHeader, SectionHeader } from '@/components/ui';
import { share } from '@/lib/enquiry-analysis';
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
  /** Already a client when they started answering — repeat business, not a
   *  new enquiry. */
  returning: boolean;
}

interface Funnel {
  started: number;
  completed: number;
  meeting: number;
  other: number;
  returning: number;
}

interface QuestionInsight {
  questionId: string;
  prompt: string;
  answered: number;
  sentElsewhere: number;
  routingAnswers: Array<{ answer: string; count: number }>;
}

interface ServiceInsight {
  eventTypeId: string | null;
  name: string;
  started: number;
  completed: number;
  meeting: number;
  other: number;
}

/* "Aligned" and "Other path" survived the vocabulary sweep by being in an
   array of labels rather than in markup. Same words the Overview figures
   use, so a figure and the list it opens agree. */
const FILTERS: { key: 'all' | Status | 'returning'; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'meeting', label: 'Went on to book' },
  { key: 'other', label: 'Sent somewhere else' },
  { key: 'in-progress', label: 'Still answering' },
  { key: 'returning', label: 'Already worked with you' },
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

export default function EnquiriesPage() {
  const { slug } = useParams<{ slug: string }>();

  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [responses, setResponses] = useState<ResponseItem[]>([]);
  const [questions, setQuestions] = useState<QuestionInsight[]>([]);
  const [services, setServices] = useState<ServiceInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /* Seeded from the URL so a figure on Overview can open this list already
     narrowed. Read once on mount rather than tracked: after that the chips
     own it, and rewriting the address bar on every chip click would put a
     dozen dead entries in the back button between here and Overview. */
  const search = useSearchParams();
  const requested = search.get('show');
  const [filter, setFilter] = useState<'all' | Status | 'returning'>(
    requested === 'meeting' ||
      requested === 'other' ||
      requested === 'in-progress' ||
      requested === 'returning'
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
        const result = await adminFetchJson<{
          stats: Funnel;
          responses: ResponseItem[];
          questions: QuestionInsight[];
          services: ServiceInsight[];
        }>(`/api/admin/${slug}/enquiries`);
        if (cancelled) return;
        setFunnel(result.stats);
        setResponses(result.responses);
        setQuestions(result.questions);
        setServices(result.services);
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

  const filtered = useMemo(() => {
    if (filter === 'all') return responses;
    /* 'returning' cuts across the other three rather than sitting beside
       them — somebody who came back also went on to book, or did not — so
       it filters on its own axis. */
    if (filter === 'returning') return responses.filter((r) => r.returning);
    return responses.filter((r) => statusOf(r) === filter);
  }, [responses, filter]);

  return (
    <div>
      {/* Its own section now, not the third tab of a builder. Writing the
          questions is something a business finishes; reading what came back
          is something they return to — and filing the second under the first
          framed a month of evidence as the last step of a setup wizard. */}
      <PageHeader
        eyebrow="Enquiries"
        title="What the questions are telling you"
        description="The last 30 days. The figures below count new enquiries — people you had not worked with before — because that is what the questions are for. Anyone who came back is counted on their own."
      />

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
            {/* Not part of the funnel, and shown beside it rather than
                inside it. Somebody you have already worked with answering
                the questions again is repeat business — a good number, and
                a different one. Counting them as fresh acquisition made
                every conversion rate on this page read better than the
                truth. */}
            <div className="stat-block" style={{ flex: '1 1 140px' }}>
              <span className="stat-block-value">{funnel.returning}</span>
              <span className="stat-block-label">Already worked with you</span>
            </div>
          </div>

          {/* ── Which questions are doing the filtering ──────────────── */}
          {questions.length > 0 && (
            <section style={{ marginTop: 34 }}>
              <SectionHeader title="Where people are turned away" />
              <p className="insight-note">
                Of the people who reached each question, how many gave an answer that
                closed the calendar. One person can be turned away by more than one
                question, so these do not add up to your total.
              </p>

              <div className="insight-list">
                {questions.map((q) => (
                  <div className="insight-row" key={q.questionId}>
                    <div className="insight-main">
                      <p className="insight-prompt">{q.prompt}</p>
                      {q.routingAnswers.length > 0 && (
                        /* The finding is the count; the decision is which
                           answer. A business can act on the second. */
                        <p className="insight-answers">
                          {q.routingAnswers
                            .slice(0, 3)
                            .map((a) => `${a.answer} (${a.count})`)
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="insight-figure">
                      <span className="insight-count">
                        {q.sentElsewhere} of {q.answered}
                      </span>
                      <div className="insight-bar" aria-hidden="true">
                        <div
                          className="insight-bar-fill"
                          style={{ width: `${share(q.sentElsewhere, q.answered)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <p className="insight-link">
                <a href={`/admin/${slug}/screening`}>Change your questions →</a>
              </p>
            </section>
          )}

          {/* ── How each service is doing ────────────────────────────── */}
          {services.length > 0 && (
            <section style={{ marginTop: 34 }}>
              <SectionHeader title="How each service is doing" />
              <p className="insight-note">
                Started and finished are kept apart on purpose. A service nobody
                finishes has a form that is too long; one everybody finishes but few
                qualify for has rules that are too tight.
              </p>

              <div className="insight-list">
                {services.map((service) => (
                  <div className="insight-row" key={service.eventTypeId ?? 'gone'}>
                    <div className="insight-main">
                      <p className="insight-prompt">{service.name}</p>
                      <p className="insight-answers">
                        {service.started} started · {service.completed} finished ·{' '}
                        {service.meeting} went on to book · {service.other} sent elsewhere
                      </p>
                    </div>
                    <div className="insight-figure">
                      <span className="insight-count">
                        {share(service.meeting, service.started)}%
                      </span>
                      <span className="insight-sub">reached the calendar</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section style={{ marginTop: 34 }}>
            <SectionHeader title="Everyone who answered" />
          </section>

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
                        {r.returning && (
                          /* Says which of these numbers this row is not
                             part of. Quiet — this is a good thing that
                             happened, just not the thing the figures
                             above are counting. */
                          <span className="returning-mark">Worked with you before</span>
                        )}
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
