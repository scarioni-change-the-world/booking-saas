'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';
import { BookingPageCard, type Branding } from '@/components/admin/BookingPageCard';
import { DEFAULT_CURRENCY, parseMoney, priceRefusal } from '@/lib/money';
import { SERVICE_TYPES, hoursSummary, serviceTypeBody, simpleWeek, weekBody, type HoursRule } from '@/lib/setup';

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
        <a className="btn-link wz-later" href={`/admin/${slug}/flow`}>
          Finish later
        </a>
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
  onDone,
  onError,
}: {
  slug: string;
  services: Service[];
  currency: string;
  onDone: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const live = services.filter((s) => s.availableToProspects || s.availableToExistingClients);
  const [adding, setAdding] = useState(services.length === 0);
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
    <form className="wz-step" onSubmit={save} aria-labelledby="wz-service">
      <h1 className="wz-title" id="wz-service">
        What do you offer?
      </h1>
      <p className="wz-lede">
        Start with one service: what people book with you most. You can add more, and questions to ask first, later.
      </p>

      {!adding ? (
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

      <Nav
        next={
          <button type="submit" className="btn-primary" disabled={busy || (adding && (!name.trim() || priceBad))}>
            {busy ? 'Saving…' : adding ? 'Add and continue' : 'Continue'}
          </button>
        }
        skip={adding && services.length === 0 ? () => void onDone() : undefined}
      />
    </form>
  );
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
          <a className="btn-primary" href={`/admin/${slug}/flow`}>
            Go to your services
          </a>
        </div>
      </div>

      <Nav onBack={onBack} next={<span />} />
    </section>
  );
}
