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
 * Share: the link for anywhere text goes, and a three-step guide for
 * putting booking on the business's own website.
 *
 *   1. Your website: saved to Account, allowed to show the booking page
 *      from then on, and read to find the tool it is made with.
 *   2. How it should look: a "Book now" button (just the link, no code)
 *      or the booking page as a section of a page (the code).
 *   3. The steps for that tool and that choice, nothing else, with a way
 *      to email them to whoever runs the site, and, once the code is up,
 *      whether it is working there (embed.js reports back).
 *
 * The list of other allowed sites is still here, folded away: most people
 * never need it, because their website is allowed on its own.
 *
 * All of that is the whole booking page. One service (its own link, its
 * own code) is a panel on the right, "Share one service", so the two never
 * get mixed up.
 */
export default function SharePage() {
  const { slug } = useParams<{ slug: string }>();
  const startOn = useSearchParams().get('service');
  const [services, setServices] = useState<Service[] | null>(null);
  const [share, setShare] = useState<ShareState | null>(null);
  const [chosen, setChosen] = useState<string | null>(startOn);
  // A page about one service usually wants that service alone.
  const [only, setOnly] = useState(true);
  const [method, setMethod] = useState<ShareMethod>('section');
  const [builder, setBuilder] = useState<BuilderId | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState<string | null>(null);

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
        setServices(types.eventTypes.filter((s) => s.active && s.availableToProspects));
        setShare(state);
        if (state.website) void detect();
      } catch (cause) {
        setError((cause as Error).message);
      }
    })();
  }, [slug, detect]);

  // ?service= may carry a service's web address or its id (Services links by id).
  const service =
    services?.find((s) => s.slug === chosen || s.id === chosen) ?? services?.[0] ?? null;
  // The left side is the whole booking page; one service lives in the panel.
  const link = origin ? `${origin}/${slug}` : '';
  const code = origin ? embedSnippet(origin, slug) : '';
  const perService = !!services && services.length > 1;
  const tool = BUILDERS[builder ?? 'other'];

  return (
    <>
      <PageHeader
        title="Share your booking page"
        description="Send people your link, or add booking to your own website in three steps."
      />

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {(!services || !share) && !error && <p className="status">Loading…</p>}

      {services && share && (
        <div className={`sh${perService ? ' has-panel' : ''}`}>
          {perService && service && (
            <ServicePanel
              services={services}
              service={service}
              only={only}
              origin={origin}
              slug={slug}
              onChoose={setChosen}
              onOnly={setOnly}
            />
          )}

          <section className="card sh-card sh-main-link" aria-labelledby="sh-link">
            <p className="wk-side-eyebrow" id="sh-link">
              Your link
            </p>
            <p className="wk-side-hint sh-lead">
              All your services, in one place. For your Instagram bio, WhatsApp, emails and your email signature.
            </p>
            <div className="sh-row">
              <code className="sh-link">{link}</code>
              <CopyButton text={link} label="Copy link" />
              <a className="btn-link" href={link} target="_blank" rel="noreferrer">
                Open
              </a>
            </div>
          </section>

          <section className="card sh-card sh-guide" aria-labelledby="sh-guide">
            <h2 className="sh-guide-title" id="sh-guide">
              Add <b className="sh-khloe">khloe</b> to your website
            </h2>

            <Step n={1} title="Your website" done={!!share.website}>
              <WebsiteStep
                slug={slug}
                website={share.website}
                onSaved={async () => {
                  await loadShare();
                  void detect();
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
            </Step>

            <Step n={2} title="What it shows, and how it looks" done={false}>
              {perService && (
                <p className="wk-side-hint sh-which">
                  This shows all your services. For a page about one of them, take its code from{' '}
                  <b>Share one service</b>; the steps below are the same.
                </p>
              )}
              <div className="sh-methods" role="radiogroup" aria-label="How it should look">
                <MethodCard
                  checked={method === 'button'}
                  onPick={() => setMethod('button')}
                  title="A “Book now” button"
                  text="Opens your booking page. Just a link: no code, works with any website."
                />
                <MethodCard
                  checked={method === 'section'}
                  onPick={() => setMethod('section')}
                  title="Booking on your page"
                  text="Your booking page as part of your page, so people book without leaving your site."
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
            </Step>

            <Step n={3} title={`Add it in ${tool.id === 'other' ? 'your website' : tool.name}`} done={false} last>
              <ol className="sh-steps">
                {(method === 'button' ? tool.button : tool.section).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <EmailSteps
                slug={slug}
                builder={builder ?? 'other'}
                method={method}
                service={null}
                only={false}
              />
              {method === 'section' && (
                <LiveStatus slug={slug} share={share} onChanged={loadShare} />
              )}
            </Step>
          </section>

          <details className="card sh-card sh-more">
            <summary>Other sites that may show your booking page</summary>
            <AllowedSites slug={slug} share={share} onSaved={loadShare} />
          </details>
        </div>
      )}
    </>
  );
}

/**
 * Share one service: pick it from the list, take its link or its code.
 *
 * Kept apart from the rest of the page on purpose. The left side is the
 * whole booking page; this is one service, for a post, an ad or that
 * service's own page on a website. Mixing the two (one picker driving both)
 * is how the every-service code ends up on a page about one service.
 *
 * A service opens alone by default: someone who clicked a link about
 * portraits wants portraits. Ticking the box keeps the other services one
 * step back.
 */
function ServicePanel({
  services,
  service,
  only,
  origin,
  slug,
  onChoose,
  onOnly,
}: {
  services: Service[];
  service: Service;
  only: boolean;
  origin: string;
  slug: string;
  onChoose: (slug: string) => void;
  onOnly: (only: boolean) => void;
}) {
  const link = origin ? `${origin}/${slug}${serviceQuery(service.slug, only)}` : '';
  const code = origin ? embedSnippet(origin, slug, service.slug, only) : '';
  return (
    <aside className="card sh-card sh-panel" aria-labelledby="sh-one">
      <h2 className="sh-panel-title" id="sh-one">
        Share one service
      </h2>
      <p className="wk-side-hint sh-lead">
        A link or code that opens straight on one service: for a post, an ad, or its own page on your website.
      </p>

      <div className="sh-svc-list" role="radiogroup" aria-label="Service to share">
        {services.map((s) => {
          const on = s.slug === service.slug;
          return (
            <label key={s.slug} className={`sh-svc${on ? ' is-on' : ''}`}>
              <input type="radio" name="sh-svc" checked={on} onChange={() => onChoose(s.slug)} />
              <span className="sh-svc-name">{s.name}</span>
              {s.durationMinutes ? <span className="sh-svc-meta">{length(s.durationMinutes)}</span> : null}
            </label>
          );
        })}
      </div>

      <label className="sh-also">
        <input type="checkbox" checked={!only} onChange={(e) => onOnly(!e.target.checked)} />
        <span>
          Show your other services too
          <small>
            {only
              ? `People see ${service.name} and nothing else.`
              : `${service.name} opens first; the rest are one step back.`}
          </small>
        </span>
      </label>

      <div className="sh-out">
        <p className="sh-out-label">Link</p>
        <code className="sh-link">{link}</code>
        <div className="sh-row">
          <CopyButton text={link} label="Copy link" />
          <a className="btn-link" href={link} target="_blank" rel="noreferrer">
            Open
          </a>
        </div>
      </div>

      <div className="sh-out">
        <p className="sh-out-label">On your website</p>
        <p className="wk-side-hint">Paste it on the page about {service.name}, following the steps in “Add khloe to your website”.</p>
        <div className="sh-row">
          <CopyButton text={code} label="Copy code" />
        </div>
        <details className="sh-peek">
          <summary>See the code</summary>
          <pre className="embed-snippet">{code}</pre>
        </details>
      </div>
    </aside>
  );
}

function Step({
  n,
  title,
  done,
  last,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`sh-step${last ? ' is-last' : ''}`}>
      <span className={`sh-step-n${done ? ' is-done' : ''}`} aria-hidden="true">
        {done ? '✓' : n}
      </span>
      <div className="sh-step-body">
        <h3 className="sh-step-title">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
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

/** 20 min, 1 h 30, 8 h. */
function length(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

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
