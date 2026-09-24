'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';
import { embedSnippet } from '@/lib/embed';

/**
 * Put the booking page inside your own website.
 *
 * This is the setting whose absence made the whole embed mechanism
 * unreachable. The column, the per-tenant frame-ancestors policy and the
 * deliberate exemption from the dashboard's X-Frame-Options have all existed
 * since early on — with no way for anyone to add a domain, so every tenant's
 * policy resolved to 'none' and nobody could embed anything. The machinery
 * was finished and the door had no handle.
 *
 * The list is edited as text rather than as rows of inputs because that is
 * how people have their domains: in their head, or pasted from an address
 * bar. One per line, normalised on save.
 */
export function EmbedSites({ slug }: { slug: string }) {
  const url = `/api/admin/${slug}/embed`;

  const [text, setText] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    try {
      const result = await adminFetchJson<{ domains: string[] }>(url);
      setDomains(result.domains);
      setText(result.domains.join('\n'));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ domains: string[]; rejected: string[] }>(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domains: text.split('\n') }),
      });
      setDomains(result.domains);
      setText(result.domains.join('\n'));
      setRejected(result.rejected);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const snippet = origin ? embedSnippet(origin, slug) : '';

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Selectable text either way. */
    }
  }

  return (
    <section className="embed-sites">
      <p className="wk-side-lead" style={{ marginTop: 0 }}>
        Your booking page can sit inside a page on your own site, so nobody has to leave it to book.
        List the sites allowed to do that — one per line.
      </p>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={save}>
        <div className="field">
          <label htmlFor="embed-domains">Sites allowed to show your booking page</label>
          <p className="field-description">
            Just the address, like <code>www.yourstudio.com</code>. Paste a full link and we&apos;ll
            trim it. <code>*.yourstudio.com</code> covers every subdomain.
          </p>
          <textarea
            id="embed-domains"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="www.yourstudio.com"
          />
        </div>

        {rejected.length > 0 && (
          /* Named rather than silently dropped: a domain that quietly failed
             to save looks exactly like one that saved and does not work. */
          <div className="notice notice-error" role="alert">
            Couldn&apos;t use {rejected.map((r) => `"${r}"`).join(', ')} — that doesn&apos;t look
            like a web address. Everything else was saved.
          </div>
        )}

        <div className="actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save sites'}
          </button>
        </div>
      </form>

      {domains.length === 0 ? (
        <p className="notice notice-muted" style={{ marginTop: 16 }}>
          No sites listed yet, so your booking page can&apos;t be shown inside another site. It
          still works on its own at <code>{origin}/t/{slug}</code>.
        </p>
      ) : (
        <div style={{ marginTop: 20 }}>
          <p className="wk-side-eyebrow" style={{ marginBottom: 6 }}>
            Paste this into your page
          </p>
          <p className="wk-side-hint" style={{ margin: '0 0 10px' }}>
            Wherever you want the booking page to appear. The second line lets it grow and shrink to
            fit, so it never scrolls inside itself.
          </p>
          <pre className="embed-snippet">{snippet}</pre>
          <div className="actions">
            <button type="button" className="btn-secondary" onClick={copySnippet}>
              {copied ? 'Copied' : 'Copy snippet'}
            </button>
          </div>
          <span aria-live="polite" className="sr-only">
            {copied ? 'Embed snippet copied to clipboard' : ''}
          </span>
        </div>
      )}
    </section>
  );
}
