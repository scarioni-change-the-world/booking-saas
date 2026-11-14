'use client';

import { useEffect, useRef, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';
import { formatMoney, minorUnitDigits } from '@/lib/money';
import {
  ASSISTANT_EXAMPLES,
  PLACES,
  type AssistantAction,
  type AssistantLink,
  type AssistantReply,
} from '@/lib/assistant/assistant';

interface Answer extends AssistantReply {
  services: Record<string, string>;
  currency: string;
  left: number | null;
}

type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; answer?: Answer };

const DAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PLURAL = ['', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];

function lengthWords(m: number): string {
  return m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

function dateWords(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' });
}

/** What a proposed change will do, in words, for its card. */
function describe(action: AssistantAction, answer: Answer): { title: string; detail: string } {
  const price = (p: number | null | undefined) =>
    p === null || p === undefined ? 'no price shown' : p === 0 ? 'free' : formatMoney(Math.round(p * 10 ** minorUnitDigits(answer.currency)), answer.currency);
  const name = (id: string) => `“${answer.services[id] ?? 'this service'}”`;
  switch (action.type) {
    case 'add_service':
      return {
        title: `Add “${action.name}”`,
        detail: `${lengthWords(action.durationMinutes)} · ${price(action.price)} · on your booking page`,
      };
    case 'update_service': {
      const parts = [
        action.name && `rename to “${action.name}”`,
        action.durationMinutes && lengthWords(action.durationMinutes),
        'price' in action && (action.price === null ? 'remove the price' : price(action.price)),
      ].filter(Boolean);
      return { title: `Change ${name(action.serviceId)}`, detail: parts.join(' · ') };
    }
    case 'pause_service':
      return { title: `Pause ${name(action.serviceId)}`, detail: 'No new bookings. Appointments already booked stay.' };
    case 'resume_service':
      return { title: `Resume ${name(action.serviceId)}`, detail: 'People can book it again.' };
    case 'set_hours': {
      const days =
        action.days.length === 7
          ? 'Every day'
          : action.days.length === 1
            ? PLURAL[action.days[0]!]!
            : action.days.map((d) => DAY[d]).join(', ');
      return {
        title: action.start ? `${days}: open ${action.start}–${action.end}` : `${days}: closed`,
        detail: 'Your usual weekly hours for these days. Other days stay as they are.',
      };
    }
    case 'time_off':
      return {
        title: action.from === action.to ? `Close ${dateWords(action.from)}` : `Close ${dateWords(action.from)} – ${dateWords(action.to)}`,
        detail: action.note ? `Time off: ${action.note}` : 'Time off: no times are offered on these days.',
      };
    case 'booking_rules':
      return {
        title: 'Change your booking rules',
        detail: [
          action.noticeHours !== undefined && `at least ${action.noticeHours} hours’ notice`,
          action.windowDays !== undefined && `bookable up to ${action.windowDays} days ahead`,
        ]
          .filter(Boolean)
          .join(' · '),
      };
  }
}

/** Where to see a change once made. */
function placeOf(action: AssistantAction): AssistantLink {
  switch (action.type) {
    case 'add_service':
      return { place: 'services' };
    case 'update_service':
    case 'pause_service':
    case 'resume_service':
      return { place: 'service', serviceId: action.serviceId };
    case 'set_hours':
      return { place: 'hours' };
    case 'time_off':
    case 'booking_rules':
      return { place: 'week' };
  }
}

function hrefOf(slug: string, link: AssistantLink): string {
  return link.place === 'service' ? `/admin/${slug}/sessions/${link.serviceId}` : `/admin/${slug}/${PLACES[link.place].href}`;
}

function labelOf(link: AssistantLink, answer?: Answer): string {
  return link.place === 'service' ? `Open ${answer?.services[link.serviceId ?? ''] ?? 'the service'}` : `Open ${PLACES[link.place].label}`;
}

/**
 * One proposed change: what it will do, and Confirm. Only Confirm saves,
 * through the same route the screen uses, so the same rules apply. Time off
 * first asks the route what is already booked on those days, and says so.
 */
function ActionCard({ slug, action, answer }: { slug: string; action: AssistantAction; answer: Answer }) {
  const [state, setState] = useState<'ask' | 'saving' | 'done' | 'dismissed'>('ask');
  const [error, setError] = useState<string | null>(null);
  const [inside, setInside] = useState<number | null>(null);
  const { title, detail } = describe(action, answer);
  const digits = minorUnitDigits(answer.currency);
  const minor = (p: number | null | undefined) => (p === null || p === undefined ? null : Math.round(p * 10 ** digits));

  useEffect(() => {
    if (action.type !== 'time_off') return;
    adminFetchJson<{ bookings: unknown[] }>(`/api/admin/${slug}/time-off`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: action.from, to: action.to, dryRun: true }),
    })
      .then((r) => setInside(r.bookings.length))
      .catch(() => setInside(null));
  }, [slug, action]);

  async function confirm() {
    setState('saving');
    setError(null);
    const json = (method: string, body: unknown) => ({
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    try {
      const base = `/api/admin/${slug}`;
      switch (action.type) {
        case 'add_service':
          await adminFetchJson(`${base}/event-types`, json('POST', {
            name: action.name,
            durationMinutes: action.durationMinutes,
            priceMinor: minor(action.price),
            availableToProspects: true,
          }));
          break;
        case 'update_service':
          await adminFetchJson(`${base}/event-types/${action.serviceId}`, json('PATCH', {
            ...(action.name ? { name: action.name } : {}),
            ...(action.durationMinutes ? { durationMinutes: action.durationMinutes } : {}),
            ...('price' in action ? { priceMinor: minor(action.price) } : {}),
          }));
          break;
        case 'pause_service':
        case 'resume_service':
          await adminFetchJson(`${base}/event-types/${action.serviceId}`, json('PATCH', { active: action.type === 'resume_service' }));
          break;
        case 'set_hours':
          await adminFetchJson(`${base}/availability-rules`, json('PUT', {
            days: action.days.map((weekday) => ({
              weekday,
              windows: action.start && action.end ? [{ startTime: action.start, endTime: action.end }] : [],
            })),
          }));
          break;
        case 'time_off':
          await adminFetchJson(`${base}/time-off`, json('POST', { from: action.from, to: action.to, note: action.note || undefined }));
          break;
        case 'booking_rules':
          await adminFetchJson(`${base}/settings`, json('PATCH', {
            ...(action.noticeHours !== undefined ? { bookingNoticeHours: action.noticeHours } : {}),
            ...(action.windowDays !== undefined ? { bookingWindowDays: action.windowDays } : {}),
          }));
          break;
      }
      setState('done');
    } catch (cause) {
      setError((cause as Error).message);
      setState('ask');
    }
  }

  if (state === 'dismissed') return <p className="ak-card-note">Not changed.</p>;

  return (
    <div className={`ak-card${state === 'done' ? ' is-done' : ''}`}>
      <p className="ak-card-title">
        {state === 'done' && <span aria-hidden="true">✓ </span>}
        {title}
      </p>
      <p className="ak-card-detail">{detail}</p>
      {action.type === 'time_off' && inside !== null && inside > 0 && state !== 'done' && (
        <p className="ak-card-warn">
          {inside === 1 ? '1 appointment is' : `${inside} appointments are`} already booked on these days. They stay: you
          can see {inside === 1 ? 'it' : 'them'} on the Week.
        </p>
      )}
      {error && (
        <p className="ak-card-warn" role="alert">
          {error}
        </p>
      )}
      {state === 'done' ? (
        <a className="btn-link" href={hrefOf(slug, placeOf(action))}>
          Done. See it
        </a>
      ) : (
        <div className="ak-card-keys">
          <button type="button" className="btn-primary" disabled={state === 'saving'} onClick={() => void confirm()}>
            {state === 'saving' ? 'Saving…' : 'Confirm'}
          </button>
          <button type="button" className="btn-link" disabled={state === 'saving'} onClick={() => setState('dismissed')}>
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * "Ask khloe": a round key in the corner of every admin page. Resting on it
 * says what it can do, with examples; pressing it opens the panel. Ask how
 * something works, why something is happening, or say what to change: a
 * change comes back as a card, and only Confirm saves it.
 */
export function AskKhloe({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [hint, setHint] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Said once, on a first visit, so the key is not a mystery; then on hover.
  useEffect(() => {
    try {
      if (window.localStorage.getItem('khloe-ask-hinted')) return;
      window.localStorage.setItem('khloe-ask-hinted', '1');
    } catch {
      return;
    }
    setHint(true);
    const t = window.setTimeout(() => setHint(false), 7000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns, busy]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function ask(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((all) => [...all, { role: 'user', text: message }]);
    setDraft('');
    setBusy(true);
    setError(null);
    try {
      const answer = await adminFetchJson<Answer>(`/api/admin/${slug}/assistant`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, history }),
      });
      setTurns((all) => [...all, { role: 'assistant', text: answer.reply, answer }]);
      if (answer.left !== null) setLeft(answer.left);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <div className={`ak-launch${hint ? ' is-hinting' : ''}`}>
          <div className="ak-hint" role="tooltip" id="ak-hint">
            <b>Ask khloe</b>
            <span>How something works, why something happens, or what to change. For example:</span>
            <ul>
              {ASSISTANT_EXAMPLES.slice(0, 3).map((e) => (
                <li key={e}>“{e}”</li>
              ))}
            </ul>
          </div>
          <button type="button" className="ak-key" aria-describedby="ak-hint" onClick={() => setOpen(true)}>
            <span className="ak-key-mark" aria-hidden="true">
              ✦
            </span>
            Ask khloe
          </button>
        </div>
      )}

      {open && (
        <section className="ak-panel" role="dialog" aria-label="Ask khloe">
          <header className="ak-head">
            <p className="ak-title">
              <span className="ak-key-mark" aria-hidden="true">
                ✦
              </span>{' '}
              Ask khloe
            </p>
            <button type="button" className="btn-link" onClick={() => setOpen(false)}>
              Close
            </button>
          </header>

          <div className="ak-body">
            {turns.length === 0 && (
              <div className="ak-empty">
                <p>
                  Ask how something works or why something happens, or tell me what to change. Changes only happen
                  when you press Confirm.
                </p>
                <div className="ak-examples">
                  {ASSISTANT_EXAMPLES.map((e) => (
                    <button key={e} type="button" className="ak-example" onClick={() => void ask(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) =>
              t.role === 'user' ? (
                <p key={i} className="ak-msg is-you">
                  {t.text}
                </p>
              ) : (
                <div key={i} className="ak-msg is-khloe">
                  <p>{t.text}</p>
                  {t.answer?.actions.map((a, j) => (
                    <ActionCard key={j} slug={slug} action={a} answer={t.answer!} />
                  ))}
                  {t.answer && t.answer.links.length > 0 && (
                    <p className="ak-links">
                      {t.answer.links.map((l, j) => (
                        <a key={j} className="btn-secondary" href={hrefOf(slug, l)}>
                          {labelOf(l, t.answer)}
                        </a>
                      ))}
                    </p>
                  )}
                </div>
              ),
            )}
            {busy && <p className="ak-msg is-khloe ak-thinking">Thinking…</p>}
            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}
            <div ref={end} />
          </div>

          <form
            className="ak-foot"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(draft);
            }}
          >
            <textarea
              ref={input}
              rows={2}
              aria-label="Ask khloe"
              placeholder="Ask, or say what to change…"
              value={draft}
              maxLength={1000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(draft);
                }
              }}
            />
            <button type="submit" className="btn-primary" disabled={busy || !draft.trim()}>
              Ask
            </button>
            {left !== null && left <= 20 && <p className="ak-left">{left} questions left this month.</p>}
          </form>
        </section>
      )}
    </>
  );
}
