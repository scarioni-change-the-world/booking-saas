'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';
import { BookingPageCard, type Branding } from '@/components/admin/BookingPageCard';
import { DEFAULT_CURRENCY, parseMoney, priceRefusal } from '@/lib/money';
import { SERVICE_TYPES, hoursSummary, serviceTypeBody, simpleWeek, weekBody, type HoursRule } from '@/lib/setup';
import { SERVICE_LIMIT } from '@/lib/service-deletion';
import type { SiteDraft } from '@/lib/ai/site-draft';

interface Account {
  business: { name: string; slug: string; timezone: string };
  branding: Branding;
  currency: string;
}

interface Service {
  id: string;
  name: string;
  active: boolean;
  availableToProspects: boolean;
  availableToExistingClients: boolean;
}

type Step = 0 | 1 | 2 | 3;
const STEPS = ['Your service', 'Your hours', 'Your look', 'Ready'];

const DAYS = [
  { n: 1, short: 'Mon', name: 'Monday' },
  { n: 2, short: 'Tue', name: 'Tuesday' },
  { n: 3, short: 'Wed', name: 'Wednesday' },
  { n: 4, short: 'Thu', name: 'Thursday' },
  { n: 5, short: 'Fri', name: 'Friday' },
  { n: 6, short: 'Sat', name: 'Saturday' },
  { n: 7, short: 'Sun', name: 'Sunday' },
];

const LENGTHS = [15, 20, 30, 45, 60, 75, 90, 120];

/**
 * Setting up, step by step: what a new business sees straight after
 * confirming its email, and what the checklist on Services offers to
 * anyone who left it half done.
 *
 * Four steps, each one screen and one question, each skippable:
 *   1. What do you offer? A kind of service, its name, length and price.
 *      It goes on the booking page straight away: in the wizard, saying
 *      what it is and pressing Continue is the decision to offer it.
 *   2. When are you available? Which days, and one stretch of hours.
 *   3. Make it yours: logo and colour, the same card as in Account.
 *   4. Ready: the booking page itself, live, with the link to share.
 *
 * Anything finer (questions, rules, payment, breaks in the day) is left to
 * the places that hold it; the checklist on Services points to them.
 */
export default function StartPage() {
  const { slug } = useParams<{ slug: string }>();
  const [step, setStep] = useState<Step>(0);
  const [account, setAccount] = useState<Account | null>(null);
  const [services, setServices] = useState<Service[] | null>(null);
  const [hours, setHours] = useState<HoursRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, s, h] = await Promise.all([
        adminFetchJson<Account>(`/api/admin/${slug}/account`),
        adminFetchJson<{ eventTypes: Service[] }>(`/api/admin/${slug}/event-types`),
        adminFetchJson<{ rules: HoursRule[] }>(`/api/admin/${slug}/availability-rules`),
      ]);
      setAccount(a);
      setServices(s.eventTypes.filter((x) => x.active));
      setHours(h.rules);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const go = (next: Step) => {
    setError(null);
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const ready = account && services && hours;

  return (
    <div className="wz">
      <header className="wz-head">
        <p className="wz-eyebrow">
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>
        <div className="wz-bar" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className={i <= step ? 'is-done' : ''} />
          ))}
        </div>
        {step < 3 && (
          <a className="btn-link wz-later" href={`/admin/${slug}/flow`}>
            Finish later
          </a>
        )}
      </header>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {!ready && !error && <p className="status">Loading…</p>}

      {ready && step === 0 && (
        <ServiceStep
          slug={slug}
          services={services}
          currency={account.currency || DEFAULT_CURRENCY}
          website={account.branding.websiteUrl}
          onDone={async () => {
            await load();
            go(1);
          }}
          onError={setError}
        />
      )}
      {ready && step === 1 && (
        <HoursStep
          slug={slug}
          rules={hours}
          timezone={account.business.timezone}
          onBack={() => go(0)}
          onDone={async () => {
            await load();
            go(2);
          }}
          onError={setError}
        />
      )}
      {ready && step === 2 && (
        <LookStep slug={slug} account={account} onSaved={load} onBack={() => go(1)} onNext={() => go(3)} />
      )}
      {ready && step === 3 && <ReadyStep slug={slug} services={services} hours={hours} onBack={() => go(2)} />}
    </div>
  );
}

function Nav({ onBack, next, skip }: { onBack?: () => void; next: React.ReactNode; skip?: () => void }) {
  return (
    <div className="wz-nav">
      {onBack ? (
        <button type="button" className="btn-link" onClick={onBack}>
          ← Back
        </button>
      ) : (
        <span />
      )}
      <div className="wz-nav-end">
        {skip && (
          <button type="button" className="btn-link" onClick={skip}>
            Skip for now
          </button>
        )}
        {next}
      </div>
    </div>
  );
}

/* ── 3. Make it yours ── */

function LookStep({
  slug,
  account,
  onSaved,
  onBack,
  onNext,
}: {
  slug: string;
  account: Account;
  onSaved: () => Promise<void>;
  onBack: () => void;
  onNext: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  return (
    <section className="wz-step" aria-labelledby="wz-look">
      <h1 className="wz-title" id="wz-look">
        Make it look like yours
      </h1>
      <p className="wz-lede">
        Your logo and your colour on the booking page, so people feel they are still with you. You can skip this and
        come back to it in Account.
      </p>
      <BookingPageCard
        slug={slug}
        businessName={account.business.name}
        saved={account.branding}
        onSaved={onSaved}
        onDirty={setDirty}
      />
      {dirty && (
        <p className="notice notice-muted" role="status">
          You have changes not saved yet. Save them in the card above, or continue without them.
        </p>
      )}
      <Nav
        onBack={onBack}
        next={
          <button type="button" className="btn-primary" onClick={onNext}>
            {dirty ? 'Continue without saving' : 'Continue'}
          </button>
        }
        skip={dirty ? undefined : onNext}
      />
    </section>
  );
}

/* ── 1. What do you offer? ── */

function ServiceStep({
  slug,
  services,
  currency,
  website,
  onDone,
  onError,
}: {
  slug: string;
  services: Service[];
  currency: string;
  website: string | null;
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const live = services.filter((s) => s.availableToProspects || s.availableToExistingClients);
  const [adding, setAdding] = useState(services.length === 0);
  // While a website draft is open for review, it is the only way forward on screen.
  const [reviewing, setReviewing] = useState(false);
  const [typeId, setTypeId] = useState('session');
  const type = SERVICE_TYPES.find((t) => t.id === typeId)!;
  const [name, setName] = useState(type.name);
  const [minutes, setMinutes] = useState(type.durationMinutes);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  function choose(id: string) {
    const next = SERVICE_TYPES.find((t) => t.id === id)!;
    if (!name.trim() || name === type.name) setName(next.name);
    setMinutes(next.durationMinutes);
    // A price already typed stays; the free intro call suggests 0.
    if (!price.trim() || price === '0') setPrice(next.priceMinor === 0 ? '0' : '');
    setTypeId(id);
  }

  const priceMinor = price.trim() === '' ? null : parseMoney(price, currency);
  const priceBad = price.trim() !== '' && priceMinor === null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!adding) return void (await onDone());
    if (!name.trim() || priceBad) return;
    setBusy(true);
    onError(null);
    try {
      await adminFetchJson(`/api/admin/${slug}/event-types`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...serviceTypeBody({ ...type, durationMinutes: minutes }, name),
          // What a price box left empty means: no price shown, not free.
          priceMinor: priceMinor,
          // Saying what it is and pressing Continue is the decision to offer it.
          availableToProspects: true,
        }),
      });
      await onDone();
    } catch (cause) {
      onError((cause as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="wz-step" aria-labelledby="wz-service">
      <h1 className="wz-title" id="wz-service">
        What do you offer?
      </h1>
      <p className="wz-lede">
        Start with one service: what people book with you most. You can add more, and questions to ask first, later.
      </p>

      {services.length === 0 && (
        <SiteDraftPanel
          slug={slug}
          currency={currency}
          website={website}
          onDone={onDone}
          onError={onError}
          onReview={setReviewing}
        />
      )}
      {services.length === 0 && !reviewing && <p className="wz-or">Or add it yourself</p>}

      <form className="wz-step" onSubmit={save} aria-label="Add a service yourself">
      {reviewing ? null : !adding ? (
        <div className="card wz-card">
          <p className="wz-have">
            You already have {live.length ? 'on your page' : 'set up'}:{' '}
            <b>{(live.length ? live : services).map((s) => s.name).join(', ')}</b>.
          </p>
          <button type="button" className="btn-link" onClick={() => setAdding(true)}>
            Add another one
          </button>
        </div>
      ) : (
        <div className="card wz-card">
          <p className="fl-type-label" id="wz-type-label">
            What kind of service is it?
          </p>
          <div className="fl-types" role="radiogroup" aria-labelledby="wz-type-label">
            {SERVICE_TYPES.map((t) => (
              <label key={t.id} className={`fl-type${typeId === t.id ? ' is-on' : ''}`}>
                <input type="radio" name="wz-type" checked={typeId === t.id} onChange={() => choose(t.id)} />
                <b>{t.label}</b>
                <span>{t.hint}</span>
              </label>
            ))}
          </div>
          <div className="wz-fields">
            <div className="field">
              <label htmlFor="wz-name">What is it called?</label>
              <input id="wz-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="wz-length">How long?</label>
              <select id="wz-length" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {[...new Set([...LENGTHS, minutes])]
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} minutes` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} hour${m > 60 ? 's' : ''}`}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="wz-price">Price ({currency})</label>
              <input
                id="wz-price"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 60"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                aria-invalid={priceBad}
                aria-describedby="wz-price-note"
              />
              <p className="field-note" id="wz-price-note">
                {priceBad ? priceRefusal(price, currency) : '0 for free. Empty shows no price.'}
              </p>
            </div>
          </div>
          {type.packSize && (
            <p className="field-note">
              People book all {type.packSize} sessions together; the price is for the whole programme.
            </p>
          )}
        </div>
      )}

      {!reviewing && <Nav
        next={
          <button type="submit" className="btn-primary" disabled={busy || (adding && (!name.trim() || priceBad))}>
            {busy ? 'Saving…' : adding ? 'Add and continue' : 'Continue'}
          </button>
        }
        skip={adding && services.length === 0 ? () => void onDone() : undefined}
      />}
      </form>
    </section>
  );
}

/* ── 1a. Start from your website ── */

interface DraftRow {
  on: boolean;
  name: string;
  minutes: number;
  price: string;
  description: string;
  stated: boolean;
}

/**
 * Reads the business's website and drafts its services and hours, for the
 * business to tick and correct. Nothing is created until they press the
 * button; then the same routes as a service typed by hand save each one.
 */
function SiteDraftPanel({
  slug,
  currency,
  website,
  onDone,
  onError,
  onReview,
}: {
  slug: string;
  currency: string;
  website: string | null;
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
  onReview: (reviewing: boolean) => void;
}) {
  const [url, setUrl] = useState(website ?? '');
  const [state, setState] = useState<'ask' | 'reading' | 'review' | 'saving'>('ask');
  const [problem, setProblem] = useState<string | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [hours, setHours] = useState<SiteDraft['hours']>(null);
  const [useHours, setUseHours] = useState(true);
  const [colour, setColour] = useState<string | null>(null);
  const [useColour, setUseColour] = useState(true);
  const [found, setFound] = useState('');
  useEffect(() => onReview(state === 'review' || state === 'saving'), [state, onReview]);

  async function read(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setState('reading');
    setProblem(null);
    try {
      const result = await adminFetchJson<{ draft: SiteDraft; website: string; colour: string | null }>(
        `/api/admin/${slug}/ai/site-draft`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) },
      );
      setFound(result.website);
      setRows(
        result.draft.services.map((s, i) => ({
          on: i < 3,
          name: s.name,
          minutes: s.durationMinutes ?? 60,
          price: s.price === null ? '' : String(s.price).replace('.', currency === 'EUR' ? ',' : '.'),
          description: s.description,
          stated: s.durationMinutes !== null,
        })),
      );
      setHours(result.draft.hours);
      setColour(result.colour);
      setState('review');
    } catch (cause) {
      setProblem((cause as Error).message);
      setState('ask');
    }
  }

  const chosen = rows.filter((r) => r.on);
  const prices = rows.map((r) => (r.price.trim() === '' ? null : parseMoney(r.price, currency)));
  const badPrice = rows.some((r, i) => r.on && r.price.trim() !== '' && prices[i] === null);
  const atLimit = chosen.length >= SERVICE_LIMIT;

  async function save() {
    setState('saving');
    onError(null);
    try {
      for (const [i, r] of rows.entries()) {
        if (!r.on || !r.name.trim()) continue;
        await adminFetchJson(`/api/admin/${slug}/event-types`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: r.name.trim(),
            durationMinutes: r.minutes,
            priceMinor: prices[i],
            ...(r.description ? { description: r.description } : {}),
            availableToProspects: true,
          }),
        });
      }
      if (hours && useHours) {
        await adminFetchJson(`/api/admin/${slug}/availability-rules`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(weekBody(hours.days, hours.start, hours.end)),
        });
      }
      // The site read is the business's own: keep it (Share uses it), and its colour if chosen.
      await adminFetchJson(`/api/admin/${slug}/branding`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ websiteUrl: found, ...(colour && useColour ? { accentColor: colour } : {}) }),
      }).catch(() => undefined);
      await onDone();
    } catch (cause) {
      onError((cause as Error).message);
      setState('review');
    }
  }

  if (state !== 'review' && state !== 'saving') {
    return (
      <form className="card wz-card wz-site" onSubmit={read}>
        <p className="fl-type-label">
          Have a website? Start from it.
          <small>
            We read your site and draft your services, prices and hours. You check everything before anything is
            saved.
          </small>
        </p>
        <div className="wz-site-row">
          <input
            type="text"
            inputMode="url"
            aria-label="Your website"
            placeholder="yourwebsite.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={state === 'reading'}
          />
          <button type="submit" className="btn-primary" disabled={state === 'reading' || !url.trim()}>
            {state === 'reading' ? 'Reading your website…' : 'Read my website'}
          </button>
        </div>
        {state === 'reading' && <p className="field-note">This takes up to half a minute.</p>}
        {problem && (
          <p className="field-note wz-bad" role="alert">
            {problem}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="card wz-card wz-site">
      <p className="fl-type-label">
        From {found.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
        <small>Tick what people can book, and correct anything we read wrong. All of it can be changed later.</small>
      </p>

      {rows.length === 0 ? (
        <p className="field-note">
          We found nothing to book on that site. Add your service below instead.{' '}
          <button type="button" className="btn-link" onClick={() => setState('ask')}>
            Try another address
          </button>
        </p>
      ) : (
        <ul className="wz-draft">
          {rows.map((r, i) => (
            <li key={i} className={r.on ? 'is-on' : ''}>
              <input
                type="checkbox"
                checked={r.on}
                disabled={!r.on && atLimit}
                aria-label={`Offer ${r.name}`}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
              />
              <input
                type="text"
                className="wz-draft-name"
                aria-label="Name"
                value={r.name}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <select
                aria-label={`How long is ${r.name}?`}
                value={r.minutes}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, minutes: Number(e.target.value), stated: true } : x)))
                }
              >
                {[...new Set([...LENGTHS, r.minutes])]
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <option key={m} value={m}>
                      {lengthLabel(m)}
                    </option>
                  ))}
              </select>
              <input
                type="text"
                inputMode="decimal"
                className="wz-draft-price"
                aria-label={`Price of ${r.name} (${currency})`}
                placeholder="No price"
                value={r.price}
                aria-invalid={r.price.trim() !== '' && prices[i] === null}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
              />
              {!r.stated && r.on && <span className="wz-draft-guess">Length not on your site: check it</span>}
            </li>
          ))}
        </ul>
      )}
      {atLimit && <p className="field-note">Up to {SERVICE_LIMIT} services can be offered at once.</p>}
      {badPrice && (
        <p className="field-note wz-bad" role="alert">
          One of the prices is not a number we can read.
        </p>
      )}

      {hours && (
        <label className="sh-also">
          <input type="checkbox" checked={useHours} onChange={(e) => setUseHours(e.target.checked)} />
          <span>
            Use these opening hours: {hoursSummary(hours.days.map((d) => ({ weekday: d, startTime: hours.start, endTime: hours.end })))}
            <small>You can change them on the next step.</small>
          </span>
        </label>
      )}
      {colour && (
        <label className="sh-also">
          <input type="checkbox" checked={useColour} onChange={(e) => setUseColour(e.target.checked)} />
          <span>
            Use your website’s colour <i className="wz-swatch" style={{ background: colour }} aria-hidden="true" /> {colour}
            <small>For buttons and highlights on your booking page.</small>
          </span>
        </label>
      )}

      <div className="wz-nav">
        <button type="button" className="btn-link" onClick={() => setState('ask')} disabled={state === 'saving'}>
          Read another address
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={state === 'saving' || chosen.length === 0 || badPrice || chosen.some((r) => !r.name.trim())}
          onClick={() => void save()}
        >
          {state === 'saving'
            ? 'Adding…'
            : `Add ${chosen.length} service${chosen.length === 1 ? '' : 's'} and continue`}
        </button>
      </div>
    </div>
  );
}

function lengthLabel(m: number): string {
  return m < 60 ? `${m} minutes` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} hour${m > 60 ? 's' : ''}`;
}

/* ── 2. When are you available? ── */

function HoursStep({
  slug,
  rules,
  timezone,
  onBack,
  onDone,
  onError,
}: {
  slug: string;
  rules: HoursRule[];
  timezone: string;
  onBack: () => void;
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const simple = simpleWeek(rules);
  // A week with different hours per day, or breaks, is kept unless they choose to replace it.
  const [replacing, setReplacing] = useState(simple !== null);
  const start = simple ?? { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };
  const [days, setDays] = useState<number[]>(start.days);
  const [from, setFrom] = useState(start.start);
  const [to, setTo] = useState(start.end);
  const [busy, setBusy] = useState(false);

  const changed =
    replacing &&
    (!simple || simple.start !== from || simple.end !== to || simple.days.join() !== [...days].sort().join());
  const bad = replacing && (days.length === 0 || from >= to);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (bad) return;
    if (!changed) return void (await onDone());
    setBusy(true);
    onError(null);
    try {
      await adminFetchJson(`/api/admin/${slug}/availability-rules`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(weekBody(days, from, to)),
      });
      await onDone();
    } catch (cause) {
      onError((cause as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="wz-step" onSubmit={save} aria-labelledby="wz-hours">
      <h1 className="wz-title" id="wz-hours">
        When can people book you?
      </h1>
      <p className="wz-lede">
        Your usual week, in your time zone ({timezone.replace(/_/g, ' ')}). Times you are busy in your calendar are
        left out once you connect it.
      </p>

      <div className="card wz-card">
        {!replacing ? (
          <>
            <p className="wz-have">
              Your hours: <b>{hoursSummary(rules)}</b>.
            </p>
            <p className="field-note">
              They differ from day to day, so they are best changed in Account → Opening hours.{' '}
              <button type="button" className="btn-link" onClick={() => setReplacing(true)}>
                Replace them with one pattern
              </button>
            </p>
          </>
        ) : (
          <>
            <p className="fl-type-label" id="wz-days-label">
              Which days?
            </p>
            <div className="wz-days" role="group" aria-labelledby="wz-days-label">
              {DAYS.map((d) => {
                const on = days.includes(d.n);
                return (
                  <button
                    key={d.n}
                    type="button"
                    className={`wz-day${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    aria-label={d.name}
                    onClick={() => setDays(on ? days.filter((x) => x !== d.n) : [...days, d.n])}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
            <div className="wz-fields wz-times">
              <div className="field">
                <label htmlFor="wz-from">From</label>
                <input id="wz-from" type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="wz-to">To</label>
                <input id="wz-to" type="time" step={900} value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <p className={`field-note${bad ? ' wz-bad' : ''}`} role={bad ? 'alert' : undefined}>
              {days.length === 0
                ? 'Choose at least one day.'
                : from >= to
                  ? 'The end must be after the start.'
                  : 'A lunch break, or different hours on some days? Set them afterwards in Account → Opening hours.'}
            </p>
          </>
        )}
      </div>

      <Nav
        onBack={onBack}
        next={
          <button type="submit" className="btn-primary" disabled={busy || bad}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
        }
      />
    </form>
  );
}

/* ── 4. Ready ── */

function ReadyStep({
  slug,
  services,
  hours,
  onBack,
}: {
  slug: string;
  services: Service[];
  hours: HoursRule[];
  onBack: () => void;
}) {
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const link = origin ? `${origin}/${slug}` : '';
  const live = services.filter((s) => s.availableToProspects);
  const bookable = live.length > 0 && hours.length > 0;

  return (
    <section className="wz-step" aria-labelledby="wz-ready">
      <h1 className="wz-title" id="wz-ready">
        {bookable ? 'Your booking page is ready' : 'Almost ready'}
      </h1>
      <p className="wz-lede">
        {bookable
          ? 'This is what people see. Try it: choose a time as a client would.'
          : live.length === 0
            ? 'There is no service on your page yet, so people cannot book. Add one from Services.'
            : 'There are no opening hours yet, so your page offers no times. Set them in Account.'}
      </p>

      <div className="wz-ready">
        <div className="wz-preview">
          {origin && <iframe src={`/t/${slug}`} title="Your booking page" loading="lazy" />}
        </div>
        <div className="card wz-card wz-share">
          <p className="fl-type-label">Your link</p>
          <code className="sh-link">{link}</code>
          <div className="sh-row">
            <button
              type="button"
              className="btn-primary"
              disabled={!link}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* It is on screen to copy by hand. */
                }
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a className="btn-link" href={link} target="_blank" rel="noreferrer">
              Open
            </a>
          </div>
          <p className="field-note">For your Instagram bio, WhatsApp and emails.</p>
          <hr className="wz-rule" />
          <p className="fl-type-label">On your website</p>
          <p className="field-note">Booking right on your own site, with the steps for the tool it is made with.</p>
          <a className="btn-secondary" href={`/admin/${slug}/share`}>
            Add it to your website
          </a>
          <hr className="wz-rule" />
          <p className="field-note">
            Next, when you have a moment: connect your calendar, and add questions to ask before people book. The
            list on Services keeps track.
          </p>
        </div>
      </div>

      {/* The same place as every step's Continue, so the end is where people look for it. */}
      <Nav
        onBack={onBack}
        next={
          <a className="btn-primary" href={`/admin/${slug}/flow`}>
            Finish setup
          </a>
        }
      />
    </section>
  );
}
