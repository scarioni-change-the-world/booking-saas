'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { Lamp } from '@/components/admin/Instruments';
import { adminFetchJson } from '@/lib/admin-fetch';
import { BUILDERS, BUILDER_ORDER, type BuilderId, type ShareMethod } from '@/lib/builders';
import { embedSnippet, serviceQuery } from '@/lib/embed';
import { websiteLabel } from '@/lib/website';

interface Service {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  availableToProspects: boolean;
  durationMinutes?: number;
  availableToExistingClients?: boolean;
}

interface Sighting {
  host: string;
  pageUrl: string;
  ok: boolean;
  seenAt: string;
  allowed: boolean;
}

interface ShareState {
  website: string | null;
  domains: string[];
  fromWebsite: string[];
  sightings: Sighting[];
  tracking: boolean;
}

/**
 * Share: one question first, "what do you want to share?" (all your
 * services, or one of them), and then the three ways to share it, in
 * order, for that choice: its link, its QR code, and on your website (a
 * three-step guide: your website, how it looks, add it).
 *
 * It used to be two panels side by side, the whole page on the left and
 * one service on the right, each with its own link, its own code and its
 * own steps. Two of everything, and nothing said which one to use.
 *
 * Services offered only to existing clients have no public link: each
 * client books them from their own, sent from Your customers.
 */
export default function SharePage() {
  const { slug } = useParams<{ slug: string }>();
  const startOn = useSearchParams().get('service');
  const [services, setServices] = useState<Service[] | null>(null);
  const [share, setShare] = useState<ShareState | null>(null);
  // null = all your services; otherwise one service's slug or id.
  const [chosen, setChosen] = useState<string | null>(startOn);
  // A page about one service usually wants that service alone.
  const [only, setOnly] = useState(true);
  const [method, setMethod] = useState<ShareMethod>('section');
  const [builder, setBuilder] = useState<BuilderId | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The open website step: the first one until there is a website, then the second.
  const [step, setStep] = useState<1 | 2 | 3>(1);

  useEffect(() => setOrigin(window.location.origin), []);

  const loadShare = useCallback(async () => {
    setShare(await adminFetchJson<ShareState>(`/api/admin/${slug}/share`));
  }, [slug]);

  const detect = useCallback(async () => {
    setDetecting(true);
    try {
      const found = await adminFetchJson<{ builder: BuilderId | null }>(`/api/admin/${slug}/share/detect`);
      setBuilder(found.builder ?? 'other');
    } catch {
      setBuilder('other');
    } finally {
      setDetecting(false);
    }
  }, [slug]);

  useEffect(() => {
    void (async () => {
      try {
        const [types, state] = await Promise.all([
          adminFetchJson<{ eventTypes: Service[] }>(`/api/admin/${slug}/event-types`),
          adminFetchJson<ShareState>(`/api/admin/${slug}/share`),
        ]);
        setServices(types.eventTypes.filter((s) => s.active));
        setShare(state);
        if (state.website) {
          setStep(2);
          void detect();
        }
      } catch (cause) {
        setError((cause as Error).message);
      }
    })();
  }, [slug, detect]);

  // Only services open to new clients are on the public page.
  const open = services?.filter((s) => s.availableToProspects) ?? [];
  const clientsOnly = services?.filter((s) => !s.availableToProspects && s.availableToExistingClients) ?? [];
  // ?service= may carry a service's web address or its id.
  const target = chosen ? open.find((s) => s.slug === chosen || s.id === chosen) ?? null : null;
  // With one service there is nothing else to show alongside it.
  const alone = only || open.length < 2;
  const link = !origin ? '' : target ? `${origin}/${slug}${serviceQuery(target.slug, alone)}` : `${origin}/${slug}`;
  const code = !origin ? '' : target ? embedSnippet(origin, slug, target.slug, alone) : embedSnippet(origin, slug);
  const what = target ? target.name : 'your booking page';
  const tool = BUILDERS[builder ?? 'other'];

  return (
    <>
      <PageHeader
        title="Share"
        description="Choose what to share, then send its link, print its QR code, or put it on your website."
      />

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {(!services || !share) && !error && <p className="status">Loading…</p>}

      {services && share && (
        <div className="sh">
          {/* What is being shared: everything, or one service. */}
          <section className="card sh-card" aria-labelledby="sh-what">
            <p className="wk-side-eyebrow" id="sh-what">
              What do you want to share?
            </p>
            {open.length === 0 ? (
              <p className="notice notice-muted">
                None of your services is on your booking page yet. Finish one in Your services, and it can be
                shared here.
              </p>
            ) : (
              <div className="wk-mode sh-choose" role="group" aria-label="What to share">
                <button type="button" className="filter-chip" aria-pressed={!target} onClick={() => setChosen(null)}>
                  All your services
                </button>
                {open.length > 1 &&
                  open.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="filter-chip"
                      aria-pressed={target?.id === s.id}
                      onClick={() => setChosen(s.id)}
                    >
                      {s.name}
                    </button>
                  ))}
              </div>
            )}
            {target && open.length > 1 && (
              <label className="sh-also">
                <input type="checkbox" checked={!only} onChange={(e) => setOnly(!e.target.checked)} />
                <span>
                  Show your other services too
                  <small>
                    {only
                      ? `People see ${target.name} and nothing else.`
                      : `${target.name} opens first; the rest are one step back.`}
                  </small>
                </span>
              </label>
            )}
            {clientsOnly.length > 0 && (
              <p className="wk-side-hint">
                {clientsOnly.map((s) => s.name).join(', ')} {clientsOnly.length === 1 ? 'is' : 'are'} for your
                clients only, so {clientsOnly.length === 1 ? 'it has' : 'they have'} no public link: each client
                books from their own, sent from Your customers.
              </p>
            )}
          </section>

          {open.length > 0 && (
            <>
              <section className="card sh-card" aria-labelledby="sh-link">
                <p className="wk-side-eyebrow" id="sh-link">
                  Link
                </p>
                <p className="wk-side-hint sh-lead">
                  {target
                    ? `Opens straight on ${target.name}: for a post, an ad or a message.`
                    : 'All your services, in one place. For your Instagram bio, WhatsApp, emails and your email signature.'}
                </p>
                <div className="sh-row">
                  <code className="sh-link">{link}</code>
                  <CopyButton text={link} label="Copy link" />
                  <a className="btn-link" href={link} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </div>
              </section>

              <section className="card sh-card" aria-labelledby="sh-qr">
                <p className="wk-side-eyebrow" id="sh-qr">
                  QR code
                </p>
                <QrCode text={link} name={target ? `${slug}-${target.slug}` : slug} label={target?.name ?? 'your booking page'} />
              </section>

              <section className="card sh-card sh-guide" aria-labelledby="sh-guide">
                <p className="wk-side-eyebrow" id="sh-guide">
                  On your website
                </p>
                <p className="wk-side-hint sh-lead">
                  {target
                    ? `Put ${target.name} on its own page of your website, in three steps.`
                    : 'Put your booking page on your website, in three steps.'}
                </p>

                {/* The three steps side by side: each says its answer, the open
                    one's content sits full width beneath them. Nothing moves. */}
                <ol className="sh-heads">
                  <StepHead n={1} step={step} done={!!share.website} title="Your website" answer={share.website ? `${hostOf(share.website)}${builder && builder !== 'other' ? ` · ${tool.name}` : ''}` : 'Not added yet'} onOpen={setStep} />
                  <StepHead n={2} step={step} done={step > 2} title="How it looks" answer={method === 'button' ? 'A “Book now” button' : `${target ? target.name : 'Booking'} on your page`} onOpen={setStep} />
                  <StepHead n={3} step={step} done={false} title={`Add it in ${tool.id === 'other' ? 'your website' : tool.name}`} answer="" onOpen={setStep} />
                </ol>

                <div className="sh-open" aria-live="polite">
                  {step === 1 && (
                    <>
                      <WebsiteStep
                        slug={slug}
                        website={share.website}
                        onSaved={async () => {
                          await loadShare();
                          void detect();
                          setStep(2);
                        }}
                      />
                      {share.website && (
                        <p className="wk-side-hint sh-tool">
                          {detecting ? (
                            'Looking at your website…'
                          ) : (
                            <>
                              Made with{' '}
                              <select
                                aria-label="Your website is made with"
                                value={builder ?? 'other'}
                                onChange={(e) => setBuilder(e.target.value as BuilderId)}
                              >
                                {BUILDER_ORDER.map((id) => (
                                  <option key={id} value={id}>
                                    {BUILDERS[id].name}
                                  </option>
                                ))}
                              </select>
                              {builder === 'other' && ' (we couldn’t tell; pick yours if it’s listed)'}
                            </>
                          )}
                        </p>
                      )}
                      {share.website && (
                        <button type="button" className="btn-primary" onClick={() => setStep(2)}>
                          Next
                        </button>
                      )}
                    </>
                  )}
                  {step === 2 && (
                    <>
                      <div className="sh-methods" role="radiogroup" aria-label="How it should look">
                        <MethodCard
                          checked={method === 'button'}
                          onPick={() => setMethod('button')}
                          title="A “Book now” button"
                          text={`Opens ${what}. Just a link: no code, works with any website.`}
                        />
                        <MethodCard
                          checked={method === 'section'}
                          onPick={() => setMethod('section')}
                          title={target ? `${target.name} on your page` : 'Booking on your page'}
                          text="As part of your page, so people book without leaving your site."
                        />
                      </div>
                      {method === 'button' ? (
                        <div className="sh-row">
                          <code className="sh-link">{link}</code>
                          <CopyButton text={link} label="Copy link" />
                        </div>
                      ) : (
                        <>
                          <pre className="embed-snippet">{code}</pre>
                          <div className="sh-row">
                            <CopyButton text={code} label="Copy code" />
                          </div>
                        </>
                      )}
                      <button type="button" className="btn-primary" onClick={() => setStep(3)}>
                        Next
                      </button>
                    </>
                  )}
                  {step === 3 && (
                    <>
                      <ol className="sh-steps">
                        {(method === 'button' ? tool.button : tool.section).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ol>
                      <EmailSteps
                        slug={slug}
                        builder={builder ?? 'other'}
                        method={method}
                        service={target?.slug ?? null}
                        only={alone}
                      />
                      {method === 'section' && <LiveStatus slug={slug} share={share} onChanged={loadShare} />}
                    </>
                  )}
                </div>

                <details className="sh-more">
                  <summary>Other sites that may show your booking page</summary>
                  <AllowedSites slug={slug} share={share} onSaved={loadShare} />
                </details>
              </section>
            </>
          )}
        </div>
      )}
    </>
  );
}

function StepHead({
  n,
  step,
  done,
  title,
  answer,
  onOpen,
}: {
  n: 1 | 2 | 3;
  step: number;
  done: boolean;
  title: string;
  answer: string;
  onOpen: (n: 1 | 2 | 3) => void;
}) {
  const open = step === n;
  return (
    <li className={`sh-head${open ? ' is-open' : ''}${done && !open ? ' is-done' : ''}`}>
      <button type="button" aria-current={open ? 'step' : undefined} onClick={() => onOpen(n)}>
        <span className="sh-step-n" aria-hidden="true">
          {done && !open ? '✓' : n}
        </span>
        <span className="sh-head-title">
          <span className="sr-only">Step {n}: </span>
          {title}
        </span>
        {!open && answer && <span className="sh-head-answer">{answer}</span>}
      </button>
    </li>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function MethodCard({
  checked,
  onPick,
  title,
  text,
}: {
  checked: boolean;
  onPick: () => void;
  title: string;
  text: string;
}) {
  return (
    <label className={`sh-method${checked ? ' is-on' : ''}`}>
      <input type="radio" name="sh-method" checked={checked} onChange={onPick} />
      <b>{title}</b>
      <span>{text}</span>
    </label>
  );
}

/** Step 1: the website, saved where Account keeps it. */
function WebsiteStep({
  slug,
  website,
  onSaved,
}: {
  slug: string;
  website: string | null;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(!website);
  const [value, setValue] = useState(website ?? '');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setValue(website ?? '');
    setEditing(!website);
  }, [website]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      await adminFetchJson(`/api/admin/${slug}/branding`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ websiteUrl: value.trim() || null }),
      });
      await onSaved();
    } catch (cause) {
      setNote((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing && website) {
    return (
      <p className="sh-website">
        <b>{websiteLabel(website)}</b>
        <span className="wk-side-hint">Allowed to show your booking page.</span>
        <button type="button" className="btn-link" onClick={() => setEditing(true)}>
          Change
        </button>
      </p>
    );
  }

  return (
    <form className="sh-row" onSubmit={save}>
      <label className="sr-only" htmlFor="sh-website">
        Your website’s address
      </label>
      <input
        id="sh-website"
        className="sh-input"
        type="text"
        inputMode="url"
        autoComplete="url"
        placeholder="www.yourstudio.com"
        maxLength={200}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn-primary" disabled={saving || !value.trim()}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {website && (
        <button type="button" className="btn-link" onClick={() => setEditing(false)}>
          Cancel
        </button>
      )}
      <p className="wk-side-hint sh-full">
        The address people type to reach your site. Saving it lets your booking page appear there, and shows a
        “Back to your website” link on your booking page.
      </p>
      {note && (
        <p className="notice notice-error sh-full" role="alert">
          {note}
        </p>
      )}
    </form>
  );
}

/** Step 3: hand the steps to whoever looks after the website. */
function EmailSteps({
  slug,
  builder,
  method,
  service,
  only,
}: {
  slug: string;
  builder: BuilderId;
  method: ShareMethod;
  service: string | null;
  only: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setNote(null);
    try {
      const result = await adminFetchJson<{ sent: boolean }>(`/api/admin/${slug}/share/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, builder, method, service, only }),
      });
      setNote(
        result.sent
          ? { ok: true, text: `Sent to ${to}. Their reply comes to you.` }
          : { ok: false, text: 'Email isn’t set up on this khloe yet, so nothing was sent.' },
      );
      if (result.sent) setTo('');
    } catch (cause) {
      setNote({ ok: false, text: (cause as Error).message });
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <p className="sh-handoff">
        Someone else runs your website?{' '}
        <button type="button" className="btn-link" onClick={() => setOpen(true)}>
          Email them these steps
        </button>
      </p>
    );
  }

  return (
    <form className="sh-handoff sh-row" onSubmit={send}>
      <label className="sr-only" htmlFor="sh-email">
        Their email address
      </label>
      <input
        id="sh-email"
        className="sh-input"
        type="email"
        placeholder="their@email.com"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        required
      />
      <button type="submit" className="btn-secondary" disabled={sending || !to.trim()}>
        {sending ? 'Sending…' : 'Send the steps'}
      </button>
      <p className="wk-side-hint sh-full">
        They get these steps with your {method === 'button' ? 'link' : 'code'}, from khloe on your behalf.
      </p>
      {note && (
        <p className={`notice ${note.ok ? 'notice-muted' : 'notice-error'} sh-full`} role="status">
          {note.text}
        </p>
      )}
    </form>
  );
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function shortPage(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * Step 3, once the code is up: where it has been seen and whether it
 * worked there. A site that showed the code but is not allowed gets an
 * "Allow it" button, which checks the page before adding it.
 */
function LiveStatus({
  slug,
  share,
  onChanged,
}: {
  slug: string;
  share: ShareState;
  onChanged: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);
  const [allowing, setAllowing] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function allow(host: string) {
    setAllowing(host);
    setNote(null);
    try {
      const result = await adminFetchJson<{ allowed: boolean; message?: string }>(`/api/admin/${slug}/share/allow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host }),
      });
      await onChanged();
      setNote(
        result.allowed
          ? { ok: true, text: `${host} is allowed. Reload that page in a minute and the booking page will appear.` }
          : { ok: false, text: result.message ?? 'That site could not be allowed.' },
      );
    } catch (cause) {
      setNote({ ok: false, text: (cause as Error).message });
    } finally {
      setAllowing(null);
    }
  }

  async function refresh() {
    setChecking(true);
    try {
      await onChanged();
    } finally {
      setChecking(false);
    }
  }

  if (!share.tracking) return null;

  return (
    <div className="sh-live" aria-live="polite">
      <p className="wk-side-eyebrow">On your website</p>
      {share.sightings.length === 0 ? (
        <p className="sh-live-row">
          <Lamp tone="off" />
          <span>
            Not seen yet. Once your page is published, open it in your browser and it will show here.
          </span>
        </p>
      ) : (
        <ul className="sh-live-list">
          {share.sightings.map((s) => (
            <li key={s.host} className="sh-live-row">
              {s.ok ? (
                <>
                  <Lamp tone="live" />
                  <span>
                    <b>Working</b> on{' '}
                    <a href={s.pageUrl} target="_blank" rel="noreferrer">
                      {shortPage(s.pageUrl)}
                    </a>
                    <span className="sh-when"> · {timeAgo(s.seenAt)}</span>
                  </span>
                </>
              ) : !s.allowed ? (
                <>
                  <Lamp tone="need" />
                  <span>
                    Your code is on <b>{shortPage(s.pageUrl)}</b>, but {s.host} isn’t allowed to show your booking
                    page yet, so it shows an empty box. Only allow it if it’s your site.
                    <span className="sh-when"> · {timeAgo(s.seenAt)}</span>
                  </span>
                  <button
                    type="button"
                    className="btn-secondary sh-allow"
                    disabled={allowing !== null}
                    onClick={() => void allow(s.host)}
                  >
                    {allowing === s.host ? 'Checking…' : 'Allow it'}
                  </button>
                </>
              ) : (
                <>
                  <Lamp tone="need" />
                  <span>
                    Your code is on <b>{shortPage(s.pageUrl)}</b>, but the booking page didn’t load there the last
                    time. If you’ve just allowed it, reload that page in a minute.
                    <span className="sh-when"> · {timeAgo(s.seenAt)}</span>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className={`notice ${note.ok ? 'notice-muted' : 'notice-error'}`} role="status">
          {note.text}
        </p>
      )}
      <button type="button" className="btn-link" onClick={() => void refresh()} disabled={checking}>
        {checking ? 'Checking…' : 'Check again'}
      </button>
    </div>
  );
}

/**
 * The link as a QR code, for flyers, business cards and a sign in the
 * studio: drawn in Ink on Soft White, downloadable as PNG (print shops,
 * Canva) and SVG (sharp at any size). The library is loaded on demand so
 * pages without it never carry it.
 */
function QrCode({ text, name, label }: { text: string; name: string; label: string }) {
  const [svg, setSvg] = useState('');
  const [png, setPng] = useState('');

  useEffect(() => {
    if (!text) return;
    let gone = false;
    void (async () => {
      const QR = await import('qrcode');
      const colors = { dark: '#202221', light: '#FCFBF8' };
      const [nextSvg, nextPng] = await Promise.all([
        QR.toString(text, { type: 'svg', margin: 2, color: colors, errorCorrectionLevel: 'M' }),
        QR.toDataURL(text, { width: 1200, margin: 2, color: colors, errorCorrectionLevel: 'M' }),
      ]);
      if (!gone) {
        setSvg(nextSvg);
        setPng(nextPng);
      }
    })();
    return () => {
      gone = true;
    };
  }, [text]);

  const svgHref = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
  return (
    <div className="sh-qr">
      {png ? (
        // A data URL drawn here, not a remote image: next/image adds nothing.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="sh-qr-img" src={png} alt={`QR code that opens ${label}`} width={112} height={112} />
      ) : (
        <span className="sh-qr-img" aria-hidden="true" />
      )}
      <div className="sh-qr-side">
        <p className="wk-side-hint">For flyers, business cards or a sign: a phone camera opens {label}.</p>
        <p className="sh-qr-get">
          <a className="btn-link" href={png || undefined} download={`${name}-qr.png`} aria-disabled={!png}>
            Download PNG
          </a>
          <a className="btn-link" href={svgHref || undefined} download={`${name}-qr.svg`} aria-disabled={!svg}>
            SVG
          </a>
        </p>
      </div>
    </div>
  );
}

/** 20 min, 1 h 30, 8 h. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn-primary"
        disabled={!text}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            /* The text stays on screen to select by hand. */
          }
        }}
      >
        {copied ? 'Copied' : label}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied to the clipboard' : ''}
      </span>
    </>
  );
}

/**
 * Sites other than the website that may show the booking page: a second
 * domain, a blog, the free address a website tool gives. One per line.
 */
function AllowedSites({
  slug,
  share,
  onSaved,
}: {
  slug: string;
  share: ShareState;
  onSaved: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setText(share.domains.join('\n')), [share.domains]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      const result = await adminFetchJson<{ domains: string[]; rejected: string[] }>(`/api/admin/${slug}/embed`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domains: text.split('\n') }),
      });
      await onSaved();
      setNote(
        result.rejected.length > 0
          ? {
              ok: false,
              text: `Couldn’t use ${result.rejected.map((r) => `“${r}”`).join(', ')}: that doesn’t look like a web address. Everything else was saved.`,
            }
          : { ok: true, text: 'Saved.' },
      );
    } catch (cause) {
      setNote({ ok: false, text: (cause as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="sh-more-body">
      <p className="wk-side-hint">
        {share.fromWebsite.length > 0 ? (
          <>
            Your website (<b>{share.fromWebsite.join(', ')}</b>) is allowed on its own. Add any other site here: a
            second domain, a blog, or a trial address like yourname.squarespace.com.
          </>
        ) : (
          <>Add the sites that may show your booking page: your domain, a blog, a trial address.</>
        )}
      </p>
      <div className="field">
        <label htmlFor="sh-domains">One per line</label>
        <textarea
          id="sh-domains"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="blog.yourstudio.com"
        />
        <p className="field-note">
          Just the address, like <code>www.yourstudio.com</code>. A pasted link is trimmed.{' '}
          <code>*.yourstudio.com</code> covers every subdomain.
        </p>
      </div>
      {note && (
        <p className={`notice ${note.ok ? 'notice-muted' : 'notice-error'}`} role="status">
          {note.text}
        </p>
      )}
      <button type="submit" className="btn-secondary" disabled={saving}>
        {saving ? 'Saving…' : 'Save sites'}
      </button>
    </form>
  );
}
