'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { PageHeader } from '@/components/ui';
import { adminFetchJson } from '@/lib/admin-fetch';
import { TEMPLATE_TOKENS } from '@/lib/email/templates';
import {
  MESSAGES,
  MOMENTS,
  describeTally,
  previewEmail,
  reminderLocalTime,
  sampleLinks,
  sampleTokens,
  type MessageId,
  type Tally,
} from '@/lib/messages';
import type { EmailTemplateKind } from '@/lib/db/types';

interface Template {
  id: string;
  kind: EmailTemplateKind;
  subject: string;
  body: string;
}

interface NextSteps {
  id: string;
  message: string;
  redirectUrl: string | null;
  redirectLabel: string | null;
}

interface Problem {
  id: string;
  kind: EmailTemplateKind;
  at: string;
  error: string | null;
  name: string | null;
  email: string | null;
}

interface Payload {
  tenantName: string;
  timezone: string;
  emailConfigured: boolean;
  notificationEmail: string | null;
  serviceName: string | null;
  templates: Template[];
  nextSteps: NextSteps | null;
  tallies: Record<EmailTemplateKind, Tally>;
  shownElsewhere: number;
  problems: Problem[];
}

interface Question {
  id: string;
  prompt: string;
  options: Array<{ label: string; outcomePathType: 'meeting' | 'other' }>;
}

type EmailDraft = { subject: string; body: string };
type StepsDraft = { message: string; redirectUrl: string; redirectLabel: string };

const ALL_IDS = MOMENTS.flatMap((m) => m.messages);

function seedMessage(value: string | null): MessageId {
  return value && (ALL_IDS as string[]).includes(value) ? (value as MessageId) : 'booking_confirmed';
}

export default function MessagesPage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearchParams();

  const [data, setData] = useState<Payload | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MessageId>(() => seedMessage(search.get('m')));

  /* Drafts are kept per message, so moving to another one to compare never
     throws away what was typed — and the journey marks which have unsaved
     changes. */
  const [emailDrafts, setEmailDrafts] = useState<Partial<Record<EmailTemplateKind, EmailDraft>>>({});
  const [stepsDraft, setStepsDraft] = useState<StepsDraft | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [payload, qs] = await Promise.all([
        adminFetchJson<Payload>(`/api/admin/${slug}/messages`),
        adminFetchJson<{ questions: Question[] }>(`/api/admin/${slug}/questions`).catch(() => ({
          questions: [] as Question[],
        })),
      ]);
      setData(payload);
      setQuestions(qs.questions);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const templateFor = (kind: EmailTemplateKind) => data?.templates.find((t) => t.kind === kind) ?? null;

  function isDirty(id: MessageId): boolean {
    if (!data) return false;
    if (id === 'next_steps') {
      if (!stepsDraft || !data.nextSteps) return false;
      const saved = data.nextSteps;
      return (
        stepsDraft.message !== saved.message ||
        stepsDraft.redirectUrl !== (saved.redirectUrl ?? '') ||
        stepsDraft.redirectLabel !== (saved.redirectLabel ?? '')
      );
    }
    const draft = emailDrafts[id];
    const saved = templateFor(id);
    return !!draft && !!saved && (draft.subject !== saved.subject || draft.body !== saved.body);
  }

  const failedTotal = data
    ? Object.values(data.tallies).reduce((n, t) => n + t.failed, 0)
    : 0;

  return (
    <>
      <PageHeader
        eyebrow="Messages"
        title="What people are told, and when"
        description="Every message you send, at the moment in someone's journey that sends it. Choose one to change its wording and see it as they will. Counts are the last 30 days."
      />

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {loading && <p className="status">Loading…</p>}

      {data && (
        <>
          {!data.emailConfigured && (
            /* Said once, here, rather than as "not sent" seven times with
               no reason. */
            <p className="wk-warning">
              Email is not switched on for this app yet, so none of the emails below are being sent.
              Everything shown on screen still is. This is set up once for the whole app, not per
              business.
            </p>
          )}
          {data.emailConfigured && failedTotal > 0 && (
            <p className="wk-warning">
              {failedTotal === 1 ? '1 email' : `${failedTotal} emails`} did not arrive in the last 30
              days. They are marked below; choose one to see who it was for and why.
            </p>
          )}

          <div className="ms-journey-wrap">
            <ol className="ms-journey" aria-label="The client's journey">
              {MOMENTS.map((moment) => (
                <li key={moment.id} className={`ms-moment tone-${moment.tone}`}>
                  <span className="ms-pin" aria-hidden="true" />
                  <h3>{moment.title}</h3>
                  {moment.messages.map((id) => {
                    const info = MESSAGES[id];
                    const tally = id === 'next_steps' ? null : data.tallies[id];
                    const warn = !!tally && tally.failed > 0;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`ms-card${warn ? ' is-warn' : ''}${info.to === 'you' ? ' is-yours' : ''}`}
                        aria-pressed={selected === id}
                        onClick={() => setSelected(id)}
                      >
                        <b>
                          {info.label}
                          {isDirty(id) && <span className="ms-dirty" title="Not saved yet"> ●</span>}
                        </b>
                        <small>
                          {id === 'next_steps'
                            ? `${data.shownElsewhere} shown`
                            : id === 'owner_notification' && !data.notificationEmail
                              ? 'Off: no address set'
                              : describeTally(tally!)}
                        </small>
                      </button>
                    );
                  })}
                </li>
              ))}
            </ol>
          </div>

          {selected === 'next_steps' ? (
            data.nextSteps ? (
              <NextStepsEditor
                key="next_steps"
                slug={slug}
                saved={data.nextSteps}
                draft={stepsDraft}
                setDraft={setStepsDraft}
                shown={data.shownElsewhere}
                questions={questions}
                onSaved={load}
              />
            ) : (
              <p className="notice notice-muted">This business has no next-steps message set up.</p>
            )
          ) : templateFor(selected) ? (
            <EmailEditor
              key={selected}
              slug={slug}
              data={data}
              template={templateFor(selected)!}
              draft={emailDrafts[selected] ?? null}
              setDraft={(d) => setEmailDrafts((all) => ({ ...all, [selected]: d }))}
              onSaved={load}
            />
          ) : (
            <p className="notice notice-muted">This message has no wording set up yet.</p>
          )}
        </>
      )}
    </>
  );
}

/* ── An email ───────────────────────────────────────────────────────────── */

function EmailEditor({
  slug,
  data,
  template,
  draft,
  setDraft,
  onSaved,
}: {
  slug: string;
  data: Payload;
  template: Template;
  draft: EmailDraft | null;
  setDraft: (draft: EmailDraft) => void;
  onSaved: () => Promise<void>;
}) {
  const kind = template.kind;
  const info = MESSAGES[kind];
  const value = draft ?? { subject: template.subject, body: template.body };
  const dirty = value.subject !== template.subject || value.body !== template.body;
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nowIso = useMemo(() => new Date().toISOString(), []);
  const tokens = useMemo(
    () => sampleTokens({ tenantName: data.tenantName, serviceName: data.serviceName, timezone: data.timezone, nowIso }),
    [data, nowIso],
  );
  const preview = previewEmail(kind, value, tokens, sampleLinks(kind, tokens, data.timezone, nowIso));
  const tally = data.tallies[kind];
  const problems = data.problems.filter((p) => p.kind === kind);

  /** Put a token where the cursor is, as if it had been typed there. */
  function insertToken(token: string) {
    const el = bodyRef.current;
    const text = `{{${token}}}`;
    if (!el) {
      setDraft({ ...value, body: value.body + text });
      return;
    }
    const start = el.selectionStart ?? value.body.length;
    const end = el.selectionEnd ?? start;
    setDraft({ ...value, body: value.body.slice(0, start) + text + value.body.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await adminFetchJson(`/api/admin/${slug}/email-templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
      await onSaved();
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ms-editor" aria-label={info.label}>
      <div className="ms-edit">
        <p className="wk-side-eyebrow">{info.to === 'you' ? 'Sent to you' : 'Sent to the client'} · email</p>
        <h2 className="ms-title">{info.label}</h2>
        <p className="ms-when">
          {info.when}
          {kind === 'booking_reminder' && ` Sent at about ${reminderLocalTime(data.timezone, nowIso)} your time.`}
        </p>
        {kind === 'owner_notification' && (
          <p className={data.notificationEmail ? 'ms-when' : 'wk-warning'}>
            {data.notificationEmail ? (
              <>Goes to {data.notificationEmail}. </>
            ) : (
              <>No address is set, so this is not sent. </>
            )}
            <a href={`/admin/${slug}/settings`}>Change it in Settings</a>
          </p>
        )}

        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}

        <div className="field">
          <label htmlFor="ms-subject">Subject</label>
          <input
            id="ms-subject"
            type="text"
            value={value.subject}
            onChange={(e) => {
              setSaved(false);
              setDraft({ ...value, subject: e.target.value });
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="ms-body">Message</label>
          <textarea
            id="ms-body"
            ref={bodyRef}
            rows={8}
            value={value.body}
            onChange={(e) => {
              setSaved(false);
              setDraft({ ...value, body: e.target.value });
            }}
          />
        </div>
        <div className="ms-tokens" role="group" aria-label="Insert a detail">
          <span>Insert:</span>
          {TEMPLATE_TOKENS[kind].map((t) => (
            <button key={t} type="button" className="ms-token" onClick={() => insertToken(t)}>
              {TOKEN_LABEL[t] ?? t}
            </button>
          ))}
        </div>
        {preview.unknownTokens.length > 0 && (
          <p className="wk-warning">
            {preview.unknownTokens.map((t) => `{{${t}}}`).join(', ')}{' '}
            {preview.unknownTokens.length === 1 ? 'is' : 'are'} not filled in for this message, so it
            will appear exactly as written.
          </p>
        )}

        <div className="wk-actions">
          <button type="button" className="btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {dirty && (
            <button
              type="button"
              className="btn-link"
              disabled={saving}
              onClick={() => setDraft({ subject: template.subject, body: template.body })}
            >
              Discard changes
            </button>
          )}
          {saved && !dirty && <span className="ms-saved">Saved. The next one sent uses this.</span>}
        </div>
      </div>

      <div className="ms-side">
        <p className="wk-side-eyebrow">{dirty ? 'As they will see it, once saved' : 'As they see it'}</p>
        <div className="ms-mail">
          <p className="ms-mail-from">
            From <b>{info.to === 'you' ? 'Intro' : data.tenantName}</b> ·{' '}
            {info.to === 'you' ? 'to you' : `to ${tokens.clientName}`}
          </p>
          <p className="ms-mail-subject">{preview.subject || <span className="wk-muted">(no subject)</span>}</p>
          <p className="ms-mail-body">{preview.body}</p>
          {preview.links.map((l) => (
            <p key={l} className="ms-mail-link">
              {l}
            </p>
          ))}
        </div>
        {info.alwaysAdded.length > 0 && (
          <p className="wk-side-hint">
            Always added, whatever you write: {info.alwaysAdded.join('; ').toLowerCase()}.
          </p>
        )}

        <p className="wk-side-eyebrow" style={{ marginTop: 18 }}>
          Last 30 days
        </p>
        <dl className="wk-facts">
          <div>
            <dt>Sent</dt>
            <dd>{tally.sent}</dd>
          </div>
          <div>
            <dt>Did not arrive</dt>
            <dd>{tally.failed}</dd>
          </div>
        </dl>
        {tally.notSent > 0 && (
          <p className="wk-side-hint">
            {tally.notSent} more {tally.notSent === 1 ? 'was' : 'were'} not sent at all, because email
            was not switched on at the time.
          </p>
        )}
        {problems.length > 0 && (
          <ul className="ms-problems">
            {problems.map((p) => (
              <li key={p.id}>
                <b>
                  {p.email ? (
                    <a href={`/admin/${slug}/people?person=${encodeURIComponent(p.email)}`}>{p.name ?? p.email}</a>
                  ) : (
                    'Someone since removed'
                  )}
                </b>
                <small>
                  {DateTime.fromISO(p.at).setZone(data.timezone).toFormat('d LLL, HH:mm')}
                  {p.error ? ` · ${plainError(p.error)}` : ''}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const TOKEN_LABEL: Record<string, string> = {
  clientName: 'Their name',
  clientEmail: 'Their email',
  serviceName: 'The service',
  dateTime: 'Date and time',
  meetingLink: 'Video link',
  packSize: 'Number of sessions',
  tenantName: 'Your business name',
};

/**
 * A mail server's reason, as far as it can be said plainly. Anything not
 * recognised is shown as it came: an honest odd sentence beats a friendly
 * wrong one.
 */
function plainError(error: string): string {
  if (/\b5\.1\.1\b|user unknown|no such user|does not exist|recipient.*rejected|550/i.test(error)) {
    return 'the address was rejected';
  }
  if (/timeout|timed out|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(error)) return 'the mail server could not be reached';
  if (/auth/i.test(error)) return 'the mail server refused the app’s login';
  return error.length > 120 ? `${error.slice(0, 117)}…` : error;
}

/* ── The next-steps message ─────────────────────────────────────────────── */

function NextStepsEditor({
  slug,
  saved,
  draft,
  setDraft,
  shown,
  questions,
  onSaved,
}: {
  slug: string;
  saved: NextSteps;
  draft: StepsDraft | null;
  setDraft: (draft: StepsDraft) => void;
  shown: number;
  questions: Question[];
  onSaved: () => Promise<void>;
}) {
  const initial = { message: saved.message, redirectUrl: saved.redirectUrl ?? '', redirectLabel: saved.redirectLabel ?? '' };
  const value = draft ?? initial;
  const dirty =
    value.message !== initial.message ||
    value.redirectUrl !== initial.redirectUrl ||
    value.redirectLabel !== initial.redirectLabel;
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const routing = questions
    .map((q) => ({ prompt: q.prompt, answers: q.options.filter((o) => o.outcomePathType === 'other').map((o) => o.label) }))
    .filter((q) => q.answers.length > 0);

  async function save() {
    setSaving(true);
    setError(null);
    setDone(false);
    try {
      await adminFetchJson(`/api/admin/${slug}/outcome-paths/${saved.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: value.message,
          redirectUrl: value.redirectUrl || null,
          redirectLabel: value.redirectLabel || null,
        }),
      });
      await onSaved();
      setDone(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const change = (patch: Partial<StepsDraft>) => {
    setDone(false);
    setDraft({ ...value, ...patch });
  };

  return (
    <section className="ms-editor" aria-label="Your next steps">
      <div className="ms-edit">
        <p className="wk-side-eyebrow">Shown to the client · on screen</p>
        <h2 className="ms-title">Your next steps</h2>
        <p className="ms-when">{MESSAGES.next_steps.when}</p>

        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}

        <div className="field">
          <label htmlFor="ms-steps-message">Message</label>
          <textarea
            id="ms-steps-message"
            rows={6}
            value={value.message}
            onChange={(e) => change({ message: e.target.value })}
          />
        </div>
        <div className="admin-field-row">
          <div className="field">
            <label htmlFor="ms-steps-url">Send them here instead (optional)</label>
            <input
              id="ms-steps-url"
              type="url"
              placeholder="https://…"
              value={value.redirectUrl}
              onChange={(e) => change({ redirectUrl: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="ms-steps-label">Link text</label>
            <input
              id="ms-steps-label"
              type="text"
              placeholder="Learn more"
              value={value.redirectLabel}
              onChange={(e) => change({ redirectLabel: e.target.value })}
            />
          </div>
        </div>

        <div className="wk-actions">
          <button type="button" className="btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {dirty && (
            <button type="button" className="btn-link" disabled={saving} onClick={() => setDraft(initial)}>
              Discard changes
            </button>
          )}
          {done && !dirty && <span className="ms-saved">Saved. The next person sent elsewhere sees this.</span>}
        </div>

        <div className="ms-who">
          <p className="wk-side-eyebrow">Who is shown this</p>
          {routing.length === 0 ? (
            <p className="ms-when">
              Nobody at the moment: no answer to your questions sends anyone elsewhere.{' '}
              <a href={`/admin/${slug}/screening`}>Change that on Questions</a>
            </p>
          ) : (
            <>
              <p className="ms-when">
                Anyone who gives one of these answers
                {routing.length > 1 ? ` — ${routing.length} questions can send someone here` : ''}.
              </p>
              {routing.map((q) => (
                <div key={q.prompt} className="ms-route">
                  <small>{q.prompt}</small>
                  <div>
                    {q.answers.map((a, i) => (
                      <span key={`${a}-${i}`} className="logic-chip ms-chip">
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <p className="wk-side-hint">
                <a href={`/admin/${slug}/screening`}>Change which answers send people here, on Questions</a>
              </p>
            </>
          )}
        </div>
      </div>

      <div className="ms-side">
        <p className="wk-side-eyebrow">{dirty ? 'As they will see it, once saved' : 'As they see it'}</p>
        <div className="preview-mat">
          <div className="preview-card">
            <div className="preview-wordmark">intro</div>
            {value.message.trim() === '' ? (
              <p className="preview-empty">
                {value.redirectUrl
                  ? 'Nothing written yet, so people sent here see only the link below.'
                  : 'Nothing written yet. People sent here are told a meeting is not the next step, and nothing else.'}
              </p>
            ) : (
              <p style={{ margin: '0 0 14px', whiteSpace: 'pre-wrap', fontSize: '0.92rem' }}>{value.message}</p>
            )}
            {value.redirectUrl && (
              <div className="preview-field" style={{ textAlign: 'center', color: 'var(--accent-ink)' }}>
                {value.redirectLabel || 'Learn more'}
              </div>
            )}
          </div>
        </div>
        <p className="wk-side-eyebrow" style={{ marginTop: 18 }}>
          Last 30 days
        </p>
        <dl className="wk-facts">
          <div>
            <dt>Shown</dt>
            <dd>{shown}</dd>
          </div>
        </dl>
        {shown > 0 && (
          <p className="wk-side-hint">
            <a href={`/admin/${slug}/people?show=elsewhere`}>See the people sent elsewhere, in People</a>
          </p>
        )}
      </div>
    </section>
  );
}
