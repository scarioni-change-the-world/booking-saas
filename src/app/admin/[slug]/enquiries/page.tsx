'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';
import { PageHeader, SectionHeader } from '@/components/ui';
import { share } from '@/lib/enquiry-analysis';

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

export default function EnquiriesPage() {
  const { slug } = useParams<{ slug: string }>();

  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [questions, setQuestions] = useState<QuestionInsight[]>([]);
  const [services, setServices] = useState<ServiceInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await adminFetchJson<{
          stats: Funnel;
          questions: QuestionInsight[];
          services: ServiceInsight[];
        }>(`/api/admin/${slug}/enquiries`);
        if (cancelled) return;
        setFunnel(result.stats);
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

          {/* The list of who answered moved to People, where each person's
              answers sit beside what they went on to do. Linked from here
              rather than repeated: two lists of the same people would be
              two places to disagree. */}
          <section style={{ marginTop: 34 }}>
            <SectionHeader title="Everyone who answered" />
            <p className="insight-note">
              Each person is in People, with what they answered and the route they took after.
            </p>
            <p className="insight-link">
              <a href={`/admin/${slug}/people`}>See them in People →</a>
            </p>
          </section>
        </>
      )}
    </div>
  );
}
