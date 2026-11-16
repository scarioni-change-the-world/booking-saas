'use client';

import { useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';
import { parseMoney } from '@/lib/money';
import { hoursSummary, weekBody } from '@/lib/setup';
import type { SiteDraft as Draft } from '@/lib/ai/site-draft';

const LENGTHS = [15, 20, 30, 45, 60, 75, 90, 120];

function lengthLabel(m: number): string {
  return m < 60 ? `${m} minutes` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} hour${m > 60 ? 's' : ''}`;
}

interface DraftRow {
  on: boolean;
  name: string;
  minutes: number;
  price: string;
  description: string;
  stated: boolean;
}

/**
 * "From my website", one of the three ways to add a service: khloe reads
 * the business's website and drafts its services (and hours, and colour)
 * for the business to tick and correct. Nothing is created until they
 * press Add; then the same route as a service typed by hand saves each
 * one, and each starts not offered, like any new service: it goes on the
 * booking page when they press "Offer it" on its page.
 */
export function SiteDraftPanel({
  slug,
  currency,
  room,
  onAdded,
}: {
  slug: string;
  currency: string;
  /** How many more services may be active (the limit, less those in use). */
  room: number;
  onAdded: () => void;
}) {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<'ask' | 'reading' | 'review' | 'saving'>('ask');
  const [problem, setProblem] = useState<string | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [hours, setHours] = useState<Draft['hours']>(null);
  const [useHours, setUseHours] = useState(true);
  const [colour, setColour] = useState<string | null>(null);
  const [useColour, setUseColour] = useState(true);
  const [found, setFound] = useState('');

  // The website given at sign-up or on Account, filled in.
  useEffect(() => {
    adminFetchJson<{ branding: { websiteUrl: string | null } }>(`/api/admin/${slug}/account`)
      .then((a) => setUrl((u) => u || a.branding.websiteUrl || ''))
      .catch(() => undefined);
  }, [slug]);

  async function read(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setState('reading');
    setProblem(null);
    try {
      const result = await adminFetchJson<{ draft: Draft; website: string; colour: string | null }>(
        `/api/admin/${slug}/ai/site-draft`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) },
      );
      setFound(result.website);
      setRows(
        result.draft.services.map((s, i) => ({
          on: i < Math.min(3, room),
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
  const atLimit = chosen.length >= room;

  async function save() {
    setState('saving');
    setProblem(null);
    try {
      for (const [i, r] of rows.entries()) {
        if (!r.on || !r.name.trim()) continue;
        await adminFetchJson(`/api/admin/${slug}/event-types`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Not offered yet: like any new service, offered from its own page.
          body: JSON.stringify({
            name: r.name.trim(),
            durationMinutes: r.minutes,
            priceMinor: prices[i],
            ...(r.description ? { description: r.description } : {}),
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
      onAdded();
    } catch (cause) {
      setProblem((cause as Error).message);
      setState('review');
    }
  }

  if (state !== 'review' && state !== 'saving') {
    return (
      <form className="ns-site" onSubmit={read}>
        <label htmlFor="ns-site-url">Your website</label>
        <p className="field-note">
          khloe reads it and drafts your services, prices and hours. You check everything before anything is saved.
        </p>
        <div className="wz-site-row">
          <input
            id="ns-site-url"
            type="text"
            inputMode="url"
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
    <div className="ns-site">
      <p className="fl-type-label">
        From {found.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
        <small>Tick what to add, and correct anything khloe read wrong. They start not offered: you offer each one from its page.</small>
      </p>

      {rows.length === 0 ? (
        <p className="field-note">
          khloe found nothing to book on that site.{' '}
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
                aria-label={`Add ${r.name}`}
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
      {atLimit && rows.length > 0 && (
        <p className="field-note">
          {room === 0 ? 'All 5 services are in use: pause one to add another.' : `Room for ${room} more.`}
        </p>
      )}
      {badPrice && (
        <p className="field-note wz-bad" role="alert">
          One of the prices is not a number khloe can read.
        </p>
      )}
      {problem && (
        <p className="field-note wz-bad" role="alert">
          {problem}
        </p>
      )}

      {hours && (
        <label className="sh-also">
          <input type="checkbox" checked={useHours} onChange={(e) => setUseHours(e.target.checked)} />
          <span>
            Use these opening hours:{' '}
            {hoursSummary(hours.days.map((d) => ({ weekday: d, startTime: hours.start, endTime: hours.end })))}
            <small>They replace your current ones. Change them any time on Account.</small>
          </span>
        </label>
      )}
      {colour && (
        <label className="sh-also">
          <input type="checkbox" checked={useColour} onChange={(e) => setUseColour(e.target.checked)} />
          <span>
            Use your website’s colour <i className="wz-swatch" style={{ background: colour }} aria-hidden="true" />{' '}
            {colour}
            <small>For buttons and highlights on your booking page.</small>
          </span>
        </label>
      )}

      <div className="sp-keys">
        <button
          type="button"
          className="btn-primary"
          disabled={state === 'saving' || chosen.length === 0 || badPrice || chosen.some((r) => !r.name.trim())}
          onClick={() => void save()}
        >
          {state === 'saving' ? 'Adding…' : `Add ${chosen.length} service${chosen.length === 1 ? '' : 's'}`}
        </button>
        <button type="button" className="btn-link" onClick={() => setState('ask')} disabled={state === 'saving'}>
          Read another address
        </button>
      </div>
    </div>
  );
}
