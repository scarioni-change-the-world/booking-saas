'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import { embedSnippet } from '@/lib/embed';

interface Service {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  availableToProspects: boolean;
}

interface Embed {
  domains: string[];
  /** Allowed without being listed: the business's own website. */
  fromWebsite: string[];
}

/**
 * Share: everything a professional needs to put their booking page in front
 * of people, in one place. The link, for anywhere text goes; the code, for
 * their own website; both for the whole page or for one service.
 *
 * It replaces a setting that lived inside one service's details, closed,
 * behind a list of allowed sites that had to be filled in before any code
 * appeared. The business's own website (Account) is now allowed on its own,
 * so for most people the code works the moment it is pasted.
 */
export default function SharePage() {
  const { slug } = useParams<{ slug: string }>();
  const startOn = useSearchParams().get('service');
  const [services, setServices] = useState<Service[] | null>(null);
  const [embed, setEmbed] = useState<Embed | null>(null);
  const [chosen, setChosen] = useState<string | null>(startOn);
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const load = useCallback(async () => {
    try {
      const [types, sites] = await Promise.all([
        adminFetchJson<{ eventTypes: Service[] }>(`/api/admin/${slug}/event-types`),
        adminFetchJson<Embed>(`/api/admin/${slug}/embed`),
      ]);
      setServices(types.eventTypes.filter((s) => s.active && s.availableToProspects));
      setEmbed(sites);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // ?service= may carry a service's web address or its id (Services links by id).
  // One that cannot be shared falls back to the whole page.
  const service = services?.find((s) => s.slug === chosen || s.id === chosen) ?? null;
  const link = origin ? `${origin}/${slug}${service ? `?service=${encodeURIComponent(service.slug)}` : ''}` : '';
  const code = origin ? embedSnippet(origin, slug, service?.slug) : '';
  const allowed = useMemo(() => [...(embed?.fromWebsite ?? []), ...(embed?.domains ?? [])], [embed]);

  return (
    <>
      <PageHeader
        title="Share your booking page"
        description="Send people a link, or put the booking page on your own website, so they can book without leaving it."
      />

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {!services && !error && <p className="status">Loading…</p>}

      {services && (
        <div className="sh">
          <section className="card sh-card" aria-labelledby="sh-what">
            <p className="wk-side-eyebrow" id="sh-what">
              What to share
            </p>
            <div className="sh-choices" role="group" aria-label="What to share">
              <button type="button" className="filter-chip" aria-pressed={!service} onClick={() => setChosen(null)}>
                All your services
              </button>
              {services.map((s) => (
                <button
                  key={s.slug}
                  type="button"
                  className="filter-chip"
                  aria-pressed={service?.slug === s.slug}
                  onClick={() => setChosen(s.slug)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <p className="wk-side-hint">
              {service
                ? `Opens straight on ${service.name}. People can still go back and see your other services.`
                : 'Opens on the list of your services.'}
            </p>
          </section>

          <section className="card sh-card" aria-labelledby="sh-link">
            <p className="wk-side-eyebrow" id="sh-link">
              Your link
            </p>
            <p className="wk-side-hint sh-lead">For your Instagram bio, WhatsApp, emails and your email signature.</p>
            <div className="sh-row">
              <code className="sh-link">{link}</code>
              <CopyButton text={link} label="Copy link" />
              <a className="btn-link" href={link} target="_blank" rel="noreferrer">
                Open
              </a>
            </div>
          </section>

          <section className="card sh-card" aria-labelledby="sh-site">
            <p className="wk-side-eyebrow" id="sh-site">
              On your website
            </p>
            <p className="wk-side-hint sh-lead">
              Paste this where you want the booking page to appear. It grows and shrinks to fit, so it never scrolls
              inside itself.
            </p>
            <pre className="embed-snippet">{code}</pre>
            <div className="sh-row">
              <CopyButton text={code} label="Copy code" />
            </div>

            <AllowedSites slug={slug} embed={embed} allowed={allowed} onSaved={load} />
          </section>

          <section className="card sh-card" aria-labelledby="sh-how">
            <p className="wk-side-eyebrow" id="sh-how">
              How to add it to your website
            </p>
            <p className="wk-side-hint sh-lead">
              Copy the code above, then follow the steps for the tool your website is made with. If someone else looks
              after your site, send them the code and these steps.
            </p>
            {BUILDERS.map((b) => (
              <details key={b.name} className="sh-builder">
                <summary>{b.name}</summary>
                <ol>
                  {b.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </details>
            ))}
            <p className="wk-side-hint">
              Still an empty box, or “refused to connect”, on your published site? The address in your browser bar is
              not one of the sites above (a trial address like yourname.squarespace.com, say). Add that address under
              “Other sites”, or put it in Account → Your website.
            </p>
          </section>
        </div>
      )}
    </>
  );
}

/** Where to paste the code, in each website tool's own words. */
const BUILDERS: Array<{ name: string; steps: string[] }> = [
  {
    name: 'Squarespace',
    steps: [
      'Edit the page and click + where you want it (or "Add block").',
      'Choose "Code".',
      'Paste the code, make sure "HTML" is selected, then click outside the block and save.',
      'Check it on your published site in a private window. Inside the Squarespace editor the box stays empty: the editor shows your page from a squarespace.com address, which is not one of your sites.',
    ],
  },
  {
    name: 'Wix',
    steps: [
      'In the editor, click + (Add Elements) → "Embed Code" → "Embed HTML".',
      'Click "Enter Code", choose "Code", paste the code and click "Update".',
      'Drag the box taller (about 900 px) so the booking page has room, then publish.',
      'Check it on your published site, not in the editor.',
    ],
  },
  {
    name: 'WordPress',
    steps: [
      'Edit the page and add a block (+).',
      'Search for "Custom HTML" and choose it.',
      'Paste the code and update the page.',
    ],
  },
  {
    name: 'Webflow',
    steps: [
      'Open the Add panel and drag an "Embed" (Code Embed) element onto the page.',
      'Paste the code and click "Save & Close".',
      'Publish the site to see it working (embeds do not run inside the Designer).',
    ],
  },
  {
    name: 'Shopify',
    steps: [
      'Online Store → Themes → Customize, and open the page where it should go.',
      'Add a section or block called "Custom Liquid" (or "Custom HTML").',
      'Paste the code and save.',
    ],
  },
  {
    name: 'Something else',
    steps: [
      'Look for a block or element called "HTML", "Code", "Embed" or "Custom code".',
      'Paste the code into it and publish.',
      'If your tool has nothing like that, use your link on a button instead.',
    ],
  },
];

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
 * Which sites may show the booking page. The business's own website is in
 * already (from Account); other sites (a second domain, a blog, a free
 * address a website tool gives) are added here, one per line.
 */
function AllowedSites({
  slug,
  embed,
  allowed,
  onSaved,
}: {
  slug: string;
  embed: Embed | null;
  allowed: string[];
  onSaved: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setText((embed?.domains ?? []).join('\n')), [embed]);

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

  const website = embed?.fromWebsite ?? [];

  return (
    <div className="sh-allowed">
      {allowed.length === 0 ? (
        <p className="notice notice-error" role="status">
          Browsers only show your booking page on sites you name, and none is named yet. Add your website in{' '}
          <a href={`/admin/${slug}/account#booking-page`}>Account → Your booking page</a>, or list it under “Other
          sites” below.
        </p>
      ) : (
        <p className="wk-side-hint">
          Works on{' '}
          {allowed.map((d, i) => (
            <span key={d}>
              {i > 0 && (i === allowed.length - 1 ? ' and ' : ', ')}
              <b>{d}</b>
            </span>
          ))}
          {website.length > 0 && ' (your website, from Account, is included on its own)'}.
        </p>
      )}

      <details className="sh-builder" open={allowed.length === 0}>
        <summary>Other sites</summary>
        <form onSubmit={save}>
          <div className="field">
            <label htmlFor="sh-domains">Other sites that may show your booking page, one per line</label>
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
      </details>
    </div>
  );
}
