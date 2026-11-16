'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';

interface Question {
  id: string;
  prompt: string;
  kind: 'text' | 'yes_no' | 'single_choice';
  required: boolean;
  eventTypeId: string | null;
}

const KIND_LABEL: Record<Question['kind'], string> = {
  text: 'Written answer',
  yes_no: 'Yes or no',
  single_choice: 'Choice',
};

/**
 * A service's Questions tab: what people answer before they book it, in
 * the order they are asked, editable right here. Shared questions (asked
 * for every service) and this service's own are told apart, since changing
 * a shared one changes it everywhere.
 *
 * The everyday edits are here: add a question with a written or yes/no
 * answer, reword one, make it optional, remove it. Choices, and answers
 * that send people elsewhere instead of to the calendar, stay on the
 * Questions page, linked: they are rules, not just words.
 *
 * Below them, the last box on the booking form (migration 0039), in the
 * business's own words.
 */
export function ServiceQuestions({
  slug,
  serviceId,
  serviceName,
  onChanged,
}: {
  slug: string;
  serviceId: string;
  serviceName: string;
  onChanged: () => void;
}) {
  const base = `/api/admin/${slug}`;
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ prompt: '', kind: 'text' as 'text' | 'yes_no', required: true, own: true });
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await adminFetchJson<{ questions: Question[] }>(`${base}/questions`);
      setQuestions(r.questions.filter((q) => q.eventTypeId === null || q.eventTypeId === serviceId));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [base, serviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const json = (method: string, body: unknown) => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.prompt.trim()) return;
    await run(() =>
      adminFetchJson(`${base}/questions`, json('POST', {
        prompt: draft.prompt.trim(),
        kind: draft.kind,
        required: draft.required,
        ...(draft.own ? { eventTypeId: serviceId } : {}),
        // A yes/no added here only collects the answer: both lead to the calendar.
        ...(draft.kind === 'yes_no'
          ? { options: [{ outcomePathType: 'meeting' }, { outcomePathType: 'meeting' }] }
          : {}),
      })),
    );
    setDraft({ prompt: '', kind: 'text', required: true, own: true });
    setAdding(false);
  }

  const shared = questions?.filter((q) => q.eventTypeId === null) ?? [];
  const own = questions?.filter((q) => q.eventTypeId === serviceId) ?? [];

  const row = (q: Question) => (
    <li key={q.id} className="sq-row">
      {editing === q.id ? (
        <form
          className="sq-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editText.trim()) return;
            void run(() => adminFetchJson(`${base}/questions/${q.id}`, json('PATCH', { prompt: editText.trim() })));
            setEditing(null);
          }}
        >
          <input
            type="text"
            aria-label="Question"
            value={editText}
            maxLength={500}
            autoFocus
            onChange={(e) => setEditText(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={busy || !editText.trim()}>
            Save
          </button>
          <button type="button" className="btn-link" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <div className="sq-main">
            <p className="sq-prompt">{q.prompt}</p>
            <p className="sq-meta">
              {KIND_LABEL[q.kind]} · {q.required ? 'Must be answered' : 'Optional'}
            </p>
          </div>
          <div className="sq-keys">
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setEditing(q.id);
                setEditText(q.prompt);
              }}
            >
              Reword
            </button>
            <button
              type="button"
              className="btn-link"
              disabled={busy}
              onClick={() => void run(() => adminFetchJson(`${base}/questions/${q.id}`, json('PATCH', { required: !q.required })))}
            >
              {q.required ? 'Make optional' : 'Make required'}
            </button>
            <button
              type="button"
              className="btn-link"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove “${q.prompt}”?${q.eventTypeId === null ? ' It is asked for every service.' : ''}`)) {
                  void run(() => adminFetchJson(`${base}/questions/${q.id}`, { method: 'DELETE' }));
                }
              }}
            >
              Remove
            </button>
          </div>
        </>
      )}
    </li>
  );

  return (
    <>
      <section className="card svc-card">
        <div className="admin-card-title">What people answer before they book</div>
        <p className="svc-lede">
          Asked in this order, before the calendar. Their answers reach you with the booking.
        </p>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {!questions && !error && <p className="status">Loading…</p>}
        {questions && questions.length === 0 && (
          <p className="svc-empty">No questions yet: people go straight to the calendar.</p>
        )}
        {shared.length > 0 && (
          <>
            <p className="sq-group">Asked for every service</p>
            <ol className="sq-list">{shared.map(row)}</ol>
          </>
        )}
        {own.length > 0 && (
          <>
            <p className="sq-group">Only for {serviceName}</p>
            <ol className="sq-list">{own.map(row)}</ol>
          </>
        )}

        {adding ? (
          <form className="sq-add" onSubmit={add}>
            <div className="field">
              <label htmlFor="sq-prompt">The question</label>
              <input
                id="sq-prompt"
                type="text"
                placeholder="e.g. Tell me briefly how I can support you"
                maxLength={500}
                autoFocus
                value={draft.prompt}
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              />
            </div>
            <div className="wk-mode sq-kind" role="group" aria-label="Kind of answer">
              {(['text', 'yes_no'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="filter-chip"
                  aria-pressed={draft.kind === k}
                  onClick={() => setDraft({ ...draft, kind: k })}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <label className="sh-also">
              <input
                type="checkbox"
                checked={draft.required}
                onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
              />
              <span>Must be answered</span>
            </label>
            <label className="sh-also">
              <input type="checkbox" checked={!draft.own} onChange={(e) => setDraft({ ...draft, own: !e.target.checked })} />
              <span>
                Ask it for every service
                <small>Otherwise only for {serviceName}.</small>
              </span>
            </label>
            <div className="fl-actions">
              <button type="submit" className="btn-primary" disabled={busy || !draft.prompt.trim()}>
                {busy ? 'Adding…' : 'Add question'}
              </button>
              <button type="button" className="btn-link" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="fl-actions">
            <button type="button" className="btn-secondary" onClick={() => setAdding(true)}>
              + Add a question
            </button>
          </div>
        )}
        <p className="svc-more">
          Choices, and answers that send people elsewhere instead of booking:{' '}
          <a href={`/admin/${slug}/screening?service=${encodeURIComponent(serviceId)}`}>on the Questions page</a>.
        </p>
      </section>

      <ClosingQuestion slug={slug} />
    </>
  );
}

/** The last box on the booking form, for every service, in the business's words. */
function ClosingQuestion({ slug }: { slug: string }) {
  const base = `/api/admin/${slug}/settings`;
  const [saved, setSaved] = useState<{ question: string; required: boolean } | null>(null);
  const [question, setQuestion] = useState('');
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [business, setBusiness] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [r, me] = await Promise.all([
          adminFetchJson<{ settings: { closingQuestion?: string | null; closingRequired?: boolean } | null }>(base),
          adminFetchJson<{ name?: string }>(`/api/admin/${slug}/me`).catch(() => ({ name: '' })),
        ]);
        const s = { question: r.settings?.closingQuestion ?? '', required: !!r.settings?.closingRequired };
        setSaved(s);
        setQuestion(s.question);
        setRequired(s.required);
        setBusiness(me.name ?? '');
      } catch (cause) {
        setError((cause as Error).message);
      }
    })();
  }, [base, slug]);

  const dirty = !!saved && (question.trim() !== saved.question || required !== saved.required);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await adminFetchJson(base, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ closingQuestion: question.trim() || null, closingRequired: required }),
      });
      setSaved({ question: question.trim(), required });
      setDone(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fallback = `Anything ${business || 'you'} should know?`;
  return (
    <form className="card svc-card" onSubmit={save}>
      <div className="admin-card-title">The last box on the booking form</div>
      <p className="svc-lede">
        Under their name and email, for every service. Ask it your way, or leave it empty for “{fallback}”.
      </p>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="field">
        <label htmlFor="closing-q">Your question</label>
        <input
          id="closing-q"
          type="text"
          maxLength={200}
          placeholder={fallback}
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            setDone(false);
          }}
        />
      </div>
      <label className="sh-also">
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => {
            setRequired(e.target.checked);
            setDone(false);
          }}
        />
        <span>
          Must be answered
          <small>{required ? 'People cannot book without answering it.' : 'Shown as optional.'}</small>
        </span>
      </label>
      <div className="fl-actions">
        <button type="submit" className="btn-primary" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {done && !dirty && <span className="ms-saved">Saved.</span>}
      </div>
    </form>
  );
}
