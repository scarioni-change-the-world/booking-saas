'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';
import {
  EMPTY_FORM,
  QuestionForm,
  formToPayload,
  questionSummary,
  questionToForm,
  routesElsewhere,
  type FormState,
  type Question,
} from '@/components/admin/QuestionForm';
import { AiSetupCard, ReplayPanel, type ReplayData } from '@/components/admin/QuestionTools';
import { NextStepsEditor, type NextSteps, type StepsDraft } from '@/components/admin/MessagesBoard';

/**
 * A service's Questions tab: what people answer before they book it, in
 * the order they are asked, edited right here with the same editor as the
 * Questions page. That includes where each answer leads: on to the
 * calendar, or to your next steps instead, which is how a business keeps
 * the wrong enquiries from booking. Shared questions (asked for every
 * service) and this service's own are told apart, since changing a shared
 * one changes it everywhere.
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
  const [draft, setDraft] = useState<FormState>(EMPTY_FORM);
  const [own, setOwn] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  /* Last month's answers, loaded once: the editor replays them under every
     change, so flipping where an answer leads shows its effect at once. */
  const [replayData, setReplayData] = useState<ReplayData | null | 'unavailable'>(null);
  useEffect(() => {
    adminFetchJson<ReplayData>(`${base}/replay`)
      .then(setReplayData)
      .catch(() => setReplayData('unavailable'));
  }, [base]);

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

  async function run(work: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
      onChanged();
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
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
    const ok = await run(() =>
      adminFetchJson(`${base}/questions`, json('POST', {
        ...formToPayload({ ...draft, prompt: draft.prompt.trim() }),
        ...(own ? { eventTypeId: serviceId } : {}),
      })),
    );
    if (!ok) return;
    setDraft(EMPTY_FORM);
    setOwn(true);
    setAdding(false);
  }

  async function save(event: React.FormEvent, id: string) {
    event.preventDefault();
    if (!editForm.prompt.trim()) return;
    const ok = await run(() =>
      adminFetchJson(`${base}/questions/${id}`, json('PATCH', formToPayload({ ...editForm, prompt: editForm.prompt.trim() }))),
    );
    if (ok) setEditing(null);
  }

  function openEditor(q: Question) {
    setAdding(false);
    if (editing === q.id) return setEditing(null);
    setEditing(q.id);
    setEditForm(questionToForm(q));
  }

  const shared = questions?.filter((q) => q.eventTypeId === null) ?? [];
  const mine = questions?.filter((q) => q.eventTypeId === serviceId) ?? [];
  const anyElsewhere =
    (questions ?? []).some((q) => q.options.some((o) => o.outcomePathType === 'other')) ||
    (adding && routesElsewhere(draft)) ||
    (editing !== null && routesElsewhere(editForm));

  const row = (q: Question) => (
    <li key={q.id} className={`sq-row${editing === q.id ? ' is-open' : ''}`}>
      <div className="sq-main">
        <p className="sq-prompt">{q.prompt}</p>
        <p className="sq-meta">{questionSummary(q)}</p>
      </div>
      <div className="sq-keys">
        <button type="button" className="btn-link" aria-expanded={editing === q.id} onClick={() => openEditor(q)}>
          {editing === q.id ? 'Close' : 'Edit'}
        </button>
        <button
          type="button"
          className="btn-link"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Remove “${q.prompt}”?${q.eventTypeId === null ? ' It is asked for every service.' : ''}`)) {
              if (editing === q.id) setEditing(null);
              void run(() => adminFetchJson(`${base}/questions/${q.id}`, { method: 'DELETE' }));
            }
          }}
        >
          Remove
        </button>
      </div>
      {editing === q.id && (
        <form className="sq-form" onSubmit={(e) => void save(e, q.id)}>
          {q.eventTypeId === null && (
            <p className="notice notice-muted">Asked for every service: a change here changes it everywhere.</p>
          )}
          <QuestionForm form={editForm} setForm={setEditForm} idPrefix={`sq-edit-${q.id}`} />
          <ReplayPanel saved={q} form={editForm} questions={questions ?? []} data={replayData} />
          <div className="fl-actions">
            <button type="submit" className="btn-primary" disabled={busy || !editForm.prompt.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn-link" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );

  return (
    <>
      <section className="card svc-card">
        <div className="admin-card-title">What people answer before they book</div>
        <p className="svc-lede">
          Asked in this order, before the calendar. Their answers reach you with the booking, and can send the
          wrong enquiries to your next steps instead of booking.
        </p>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {!questions && !error && <p className="status">Loading…</p>}
        {questions && questions.length === 0 && !adding && (
          <p className="svc-empty">No questions yet: people go straight to the calendar.</p>
        )}
        {shared.length > 0 && (
          <>
            <p className="sq-group">Asked for every service</p>
            <ol className="sq-list">{shared.map(row)}</ol>
          </>
        )}
        {mine.length > 0 && (
          <>
            <p className="sq-group">Only for {serviceName}</p>
            <ol className="sq-list">{mine.map(row)}</ol>
          </>
        )}

        {adding ? (
          <form className="sq-form sq-add" onSubmit={add}>
            <p className="sq-group">A new question</p>
            <QuestionForm form={draft} setForm={setDraft} idPrefix="sq-new" />
            <label className="sh-also">
              <input type="checkbox" checked={!own} onChange={(e) => setOwn(!e.target.checked)} />
              <span>
                Ask it for every service
                <small>Otherwise only for {serviceName}.</small>
              </span>
            </label>
            <div className="fl-actions">
              <button type="submit" className="btn-primary" disabled={busy || !draft.prompt.trim()}>
                {busy ? 'Adding…' : 'Add question'}
              </button>
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setAdding(false);
                  setDraft(EMPTY_FORM);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="fl-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setEditing(null);
                setAdding(true);
              }}
            >
              + Add a question
            </button>
            <AiSetupCard
              slug={slug}
              eventTypes={[{ id: serviceId, name: serviceName, availableToProspects: true }]}
              defaultServiceId={serviceId}
              onQuestionsAdded={() => {
                void load();
                onChanged();
              }}
            />
          </div>
        )}
      </section>

      {/* Where the wrong enquiries go, written right here: whenever an
          answer sends someone to your next steps, this is what they see. */}
      {anyElsewhere && <NextStepsHere slug={slug} questions={questions ?? []} />}

      <ClosingQuestion slug={slug} />
    </>
  );
}

/** The next-steps message, the same one Messages shows, edited in place. */
function NextStepsHere({ slug, questions }: { slug: string; questions: Question[] }) {
  const [saved, setSaved] = useState<{ nextSteps: NextSteps | null; shownElsewhere: number } | null>(null);
  const [draft, setDraft] = useState<StepsDraft | null>(null);
  const load = useCallback(async () => {
    try {
      setSaved(await adminFetchJson<{ nextSteps: NextSteps | null; shownElsewhere: number }>(`/api/admin/${slug}/messages`));
    } catch {
      setSaved({ nextSteps: null, shownElsewhere: 0 });
    }
  }, [slug]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!saved?.nextSteps) return null;
  return (
    <div className="sq-next">
      <p className="sq-group">What people sent to your next steps see</p>
      <NextStepsEditor
        slug={slug}
        saved={saved.nextSteps}
        draft={draft}
        setDraft={setDraft}
        shown={saved.shownElsewhere}
        questions={questions}
        onSaved={async () => {
          setDraft(null);
          await load();
        }}
      />
    </div>
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
