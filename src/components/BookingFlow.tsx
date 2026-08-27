'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { accentStyle, initials } from './brand';
import { useAutoResize } from './useAutoResize';
import type { DaySlots, PublicConfig, PublicEventType, PublicQuestion } from './types';

type Audience = 'prospect' | 'client';

type Step =
  | 'loading'
  | 'questions'
  | 'redirected'
  | 'pick-type'
  | 'pick-time'
  | 'details'
  | 'done';

interface Props {
  slug: string;
  audience: Audience;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? 'Request failed');
  return body as T;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? 'Request failed');
  return body as T;
}

/**
 * The booking flow, for both audiences.
 *
 * Prospects pass through the qualification gate first; existing clients skip
 * it entirely and never see it (brief 2.1, 2.3). One component serves both
 * because everything after the gate is identical, and keeping two copies in
 * step is exactly the sort of drift that produced the "one flag instead of two"
 * bug in the reference implementation.
 *
 * Built mobile-first: a prospect arrives from a link in Instagram or
 * WhatsApp, on a phone, usually one-handed. The wider viewport is the
 * exception this layout has to survive, not the one it is designed for.
 */
export default function BookingFlow({ slug, audience }: Props) {
  useAutoResize();

  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [responseId, setResponseId] = useState<string | null>(null);
  const [redirect, setRedirect] = useState<{
    message: string;
    url: string | null;
    label: string | null;
  } | null>(null);

  const [eventTypes, setEventTypes] = useState<PublicEventType[]>([]);
  const [eventType, setEventType] = useState<PublicEventType | null>(null);
  const [days, setDays] = useState<DaySlots[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState<{
    startsAt: string;
    manageToken: string;
    meetingUrl: string | null;
  } | null>(null);

  const base = `/api/t/${encodeURIComponent(slug)}`;

  /** The client's own timezone, used only for display. */
  const viewerZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [cfg, types] = await Promise.all([
          getJson<PublicConfig>(`${base}/config`),
          getJson<{ eventTypes: PublicEventType[] }>(`${base}/event-types?audience=${audience}`),
        ]);
        if (cancelled) return;

        setConfig(cfg);
        setEventTypes(types.eventTypes);

        if (audience === 'prospect') {
          const q = await getJson<{ questions: PublicQuestion[] }>(`${base}/questions`);
          if (cancelled) return;
          setQuestions(q.questions);
          // A tenant with no questions configured has no gate to apply.
          setStep(q.questions.length > 0 ? 'questions' : 'pick-type');
        } else {
          setStep('pick-type');
        }
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [base, audience]);

  // Auto-skip the type picker when there is only one choice (brief 2.3).
  useEffect(() => {
    if (step === 'pick-type' && eventTypes.length === 1) {
      setEventType(eventTypes[0]!);
      setStep('pick-time');
    }
  }, [step, eventTypes]);

  const loadAvailability = useCallback(
    async (chosen: PublicEventType) => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({ eventTypeId: chosen.id, audience });
        if (responseId) params.set('responseId', responseId);
        const result = await getJson<{ days: DaySlots[] }>(
          `${base}/availability?${params.toString()}`,
        );
        setDays(result.days);
        // Land on the first day that actually has something to book, rather
        // than the calendar's literal first day, which is usually empty.
        setSelectedDate(result.days.find((d) => d.slots.length > 0)?.date ?? null);
      } catch (cause) {
        setError((cause as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [base, audience, responseId],
  );

  useEffect(() => {
    if (step === 'pick-time' && eventType) void loadAvailability(eventType);
  }, [step, eventType, loadAvailability]);

  async function submitAnswers(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<{
        outcome: 'qualified' | 'redirected';
        responseId: string;
        message?: string;
        redirectUrl?: string | null;
        redirectLabel?: string | null;
      }>(`${base}/qualify`, { answers });

      if (result.outcome === 'redirected') {
        setRedirect({
          message: result.message ?? config?.disqualification.message ?? '',
          url: result.redirectUrl ?? null,
          label: result.redirectLabel ?? null,
        });
        setStep('redirected');
        return;
      }

      setResponseId(result.responseId);
      setStep('pick-type');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitBooking(event: React.FormEvent) {
    event.preventDefault();
    if (!eventType || !slot) return;

    setBusy(true);
    setError(null);
    try {
      const result = await postJson<{
        booking: { startsAt: string; manageToken: string; meetingUrl: string | null };
      }>(`${base}/bookings`, {
        eventTypeId: eventType.id,
        startsAt: slot,
        name,
        email,
        notes,
        audience,
        responseId,
      });
      setConfirmed(result.booking);
      setStep('done');
    } catch (cause) {
      setError((cause as Error).message);
      // A 409 means the slot went while the form was open. Reload the calendar
      // rather than leaving a stale grid the client can pick from again.
      if ((cause as Error).message.toLowerCase().includes('available')) {
        setSlot(null);
        setStep('pick-time');
      }
    } finally {
      setBusy(false);
    }
  }

  const dayFormat = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const dowFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

  /** Render a tenant-local 'yyyy-MM-dd' as a day heading. */
  const formatDay = (date: string) => dayFormat.format(new Date(`${date}T12:00:00`));

  /**
   * Render the day an instant falls on, in the viewer's timezone.
   *
   * Not the same as slicing the ISO string: that yields the UTC date, which is
   * the wrong day for any viewer whose local date has already rolled over.
   */
  const formatInstantDay = (iso: string) => dayFormat.format(new Date(iso));

  const formatTime = (iso: string) => timeFormat.format(new Date(iso));

  /** "10:00 – 10:30", using the event type's own duration — never a fixed grid. */
  const formatTimeRange = (iso: string, durationMinutes: number) => {
    const start = new Date(iso);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    return `${timeFormat.format(start)} – ${timeFormat.format(end)}`;
  };

  const answeredCount = questions.filter((q) => (answers[q.id] ?? '').trim() !== '').length;

  if (step === 'loading' && !error) {
    return (
      <main className="widget">
        <p className="status">Loading…</p>
      </main>
    );
  }

  const activeDay = days.find((d) => d.date === selectedDate) ?? null;

  return (
    <main className="widget" style={accentStyle(config?.branding.accentColor)}>
      {config && (
        <div className="brand-row">
          <div className="brand-mark">
            {config.branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied, arbitrary remote host
              <img src={config.branding.logoUrl} alt="" />
            ) : (
              initials(config.name)
            )}
          </div>
          <span className="brand-name">{config.name}</span>
        </div>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {step === 'questions' && (
        <form onSubmit={submitAnswers}>
          <p className="lede">A few questions before we find a time.</p>

          {questions.map((question) => (
            <div className="field" key={question.id}>
              <span className="prompt">
                {question.prompt}
                {question.required && <span className="required">*</span>}
              </span>

              {question.kind === 'text' ? (
                <textarea
                  value={answers[question.id] ?? ''}
                  required={question.required}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))
                  }
                />
              ) : (
                <div className="options">
                  {question.options.map((option) => (
                    <label
                      key={option}
                      className={`option${answers[question.id] === option ? ' selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name={question.id}
                        value={option}
                        required={question.required}
                        checked={answers[question.id] === option}
                        onChange={() =>
                          setAnswers((prev) => ({ ...prev, [question.id]: option }))
                        }
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}

          <button type="submit" className="btn-primary btn-full" disabled={busy}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
          <p className="progress-label">
            {answeredCount} of {questions.length} answered
          </p>
        </form>
      )}

      {step === 'redirected' && redirect && (
        <div className="card">
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{redirect.message}</p>
          {redirect.url && (
            <div className="actions">
              <a
                className="btn-primary btn-full"
                href={redirect.url}
                style={{ textDecoration: 'none', textAlign: 'center' }}
              >
                {redirect.label ?? 'Find out more'}
              </a>
            </div>
          )}
        </div>
      )}

      {step === 'pick-type' && (
        <>
          <h2>Choose a session</h2>
          {eventTypes.length === 0 ? (
            <p className="notice notice-muted">
              There are no sessions available to book right now.
            </p>
          ) : (
            <div className="type-list">
              {eventTypes.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  className="type"
                  onClick={() => {
                    setEventType(type);
                    setStep('pick-time');
                  }}
                >
                  <strong>{type.name}</strong>
                  <span>
                    {type.durationMinutes} min
                    {type.description ? ` · ${type.description}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {step === 'pick-time' && eventType && (
        <>
          <h2>Pick a time</h2>
          {busy && <p className="status">Loading times…</p>}

          {!busy && days.length === 0 && (
            <p className="notice notice-muted">
              No times are available in the next few weeks.
            </p>
          )}

          {days.length > 0 && (
            <>
              <div className="date-strip">
                {days.map((day) => {
                  const date = new Date(`${day.date}T12:00:00`);
                  const has = day.slots.length > 0;
                  const active = day.date === selectedDate;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      className={`date-chip${active ? ' active' : ''}${has ? '' : ' empty'}`}
                      disabled={!has}
                      onClick={() => setSelectedDate(day.date)}
                    >
                      <span className="dow">{dowFormat.format(date)}</span>
                      <span className="num">{date.getDate()}</span>
                    </button>
                  );
                })}
              </div>

              {activeDay && (
                <>
                  <p className="day-label">{formatDay(activeDay.date)}</p>
                  <div className="slots">
                    {activeDay.slots.map((iso) => (
                      <button
                        key={iso}
                        type="button"
                        className="slot"
                        onClick={() => {
                          setSlot(iso);
                          setStep('details');
                        }}
                      >
                        {formatTimeRange(iso, eventType.durationMinutes)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          <p className="tz">Times shown in your timezone ({viewerZone}).</p>

          {eventTypes.length > 1 && (
            <div className="actions">
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setEventType(null);
                  setDays([]);
                  setSelectedDate(null);
                  setStep('pick-type');
                }}
              >
                Choose a different session
              </button>
            </div>
          )}
        </>
      )}

      {step === 'details' && eventType && slot && (
        <form onSubmit={submitBooking}>
          <h2>Your details</h2>
          <p className="lede">
            {eventType.name} · {formatInstantDay(slot)} at {formatTime(slot)}
          </p>

          <div className="field">
            <label htmlFor="name">
              Name<span className="required">*</span>
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="email">
              Email<span className="required">*</span>
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="notes">Anything we should know?</label>
            <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <button type="submit" className="btn-primary btn-full" disabled={busy}>
            {busy ? 'Booking…' : 'Confirm booking'}
          </button>
          <div className="actions" style={{ justifyContent: 'center' }}>
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setSlot(null);
                setStep('pick-time');
              }}
            >
              Pick another time
            </button>
          </div>
        </form>
      )}

      {step === 'done' && confirmed && (
        <>
          <h2>You&apos;re booked</h2>
          <div className="hero">
            <div className="eyebrow">{formatInstantDay(confirmed.startsAt)}</div>
            <div className="when">{formatTime(confirmed.startsAt)}</div>
            {eventType && <div className="what">{eventType.name}</div>}
          </div>

          {confirmed.meetingUrl && (
            <a className="hero-link" href={confirmed.meetingUrl}>
              Join the video call
            </a>
          )}

          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 16 }}>
            Keep this link to reschedule or cancel:{' '}
            <a href={`/manage/${confirmed.manageToken}`}>manage your booking</a>.
          </p>
        </>
      )}

      <p className="footer-credit">Powered by intro</p>
    </main>
  );
}
