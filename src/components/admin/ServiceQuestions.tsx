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
  // What the last save now does, said once under the list.
  const [notice, setNotice] = useState<string | null>(null);
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
    setNotice(savedLine(draft));
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
    if (ok) {
      setNotice(savedLine(editForm));
      setEditing(null);
    }
  }

  function openEditor(q: Question) {
    setAdding(false);
    setNotice(null);
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
        <div className="admin-card-title">Your filters</div>
        <p className="svc-lede">
          Questions people answer before they see your calendar, in this order. Choose where each answer leads: on to
          book, or to your next steps. Their answers reach you with the booking.
        </p>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {!questions && !error && <p className="status">Loading…</p>}
        {questions && questions.length === 0 && !adding && (
          <p className="svc-empty">No filters: everyone goes straight to the calendar.</p>
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

        {notice && (
          <p className="sq-saved" role="status">
            ✓ {notice}
          </p>
        )}

        {adding ? (
          <form className="sq-form sq-add" onSubmit={add}>
            <p className="sq-group">A new filter</p>
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
                {busy ? 'Adding…' : 'Add filter'}
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
              + Add a filter
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

/** What a filter does once saved, in one sentence. */
function savedLine(form: FormState): string {
  const prompt = `“${form.prompt.trim()}”`;
  if (form.kind === 'text') return `Saved. ${prompt} is asked, and the answer reaches you; it filters nobody.`;
  const options = formToPayload(form).options;
  const away = options.filter((o) => o.outcomePathType === 'other').map((o) => `“${o.label}”`);
  if (away.length === 0) return `Saved. Every answer to ${prompt} goes on to book.`;
  if (away.length === options.length) return `Saved. Every answer to ${prompt} goes to your next steps, so nobody can book.`;
  return `Saved. People who answer ${away.join(' or ')} to ${prompt} see your next steps.`;
}
