'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';
import Toggle from '@/components/admin/Toggle';

type Kind = 'text' | 'yes_no' | 'single_choice';
type PathType = 'meeting' | 'other';

interface Option {
  label: string;
  outcomePathType: PathType;
}

interface Question {
  id: string;
  prompt: string;
  kind: Kind;
  options: Option[];
  required: boolean;
  sortOrder: number;
}

interface FormState {
  prompt: string;
  kind: Kind;
  required: boolean;
  yesNo: [Option, Option];
  choices: Option[];
}

const EMPTY_FORM: FormState = {
  prompt: '',
  kind: 'text',
  required: true,
  yesNo: [
    { label: 'Yes', outcomePathType: 'meeting' },
    { label: 'No', outcomePathType: 'meeting' },
  ],
  choices: [{ label: '', outcomePathType: 'meeting' }],
};

const KIND_LABEL: Record<Kind, string> = {
  text: 'Free text',
  yes_no: 'Yes / no',
  single_choice: 'Choose one',
};

function formToPayload(form: FormState) {
  return {
    prompt: form.prompt,
    kind: form.kind,
    required: form.required,
    options: form.kind === 'yes_no' ? form.yesNo : form.kind === 'single_choice' ? form.choices : [],
  };
}

function questionToForm(q: Question): FormState {
  return {
    prompt: q.prompt,
    kind: q.kind,
    required: q.required,
    yesNo:
      q.kind === 'yes_no' && q.options.length === 2
        ? [q.options[0]!, q.options[1]!]
        : EMPTY_FORM.yesNo,
    choices: q.kind === 'single_choice' && q.options.length > 0 ? q.options : EMPTY_FORM.choices,
  };
}

/**
 * The form fields for one question — shared between "add" and "edit", since
 * a second, slightly-different copy of this is exactly how the two would
 * drift apart the first time someone fixes a bug in only one of them.
 */
function QuestionForm({
  form,
  setForm,
  idPrefix,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  idPrefix: string;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-prompt`}>Question</label>
        <textarea
          id={`${idPrefix}-prompt`}
          required
          value={form.prompt}
          onChange={(e) => setForm({ ...form, prompt: e.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-kind`}>Type of answer</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {(Object.keys(KIND_LABEL) as Kind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className={form.kind === kind ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setForm({ ...form, kind })}
            >
              {KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      </div>

      {form.kind === 'text' && (
        <p className="notice notice-muted">
          Free text is recorded but never routes anyone — there is no reliable way to judge it
          automatically.
        </p>
      )}

      {form.kind === 'yes_no' && (
        <div className="field">
          <label>Does each answer continue on, or send someone down the other path?</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {form.yesNo.map((opt, i) => (
              <div
                key={opt.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 13px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <span>{opt.label}</span>
                <Toggle
                  on={opt.outcomePathType === 'meeting'}
                  label={opt.outcomePathType === 'meeting' ? 'Continues' : 'Other path'}
                  onClick={() => {
                    const yesNo = [...form.yesNo] as [Option, Option];
                    yesNo[i] = {
                      ...yesNo[i]!,
                      outcomePathType: yesNo[i]!.outcomePathType === 'meeting' ? 'other' : 'meeting',
                    };
                    setForm({ ...form, yesNo });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {form.kind === 'single_choice' && (
        <div className="field">
          <label>Answers</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {form.choices.map((opt, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="text"
                  placeholder={`Answer ${i + 1}`}
                  value={opt.label}
                  style={{ flex: 1 }}
                  onChange={(e) => {
                    const choices = [...form.choices];
                    choices[i] = { ...choices[i]!, label: e.target.value };
                    setForm({ ...form, choices });
                  }}
                />
                <Toggle
                  on={opt.outcomePathType === 'meeting'}
                  label={opt.outcomePathType === 'meeting' ? 'Continues' : 'Other path'}
                  onClick={() => {
                    const choices = [...form.choices];
                    choices[i] = {
                      ...choices[i]!,
                      outcomePathType: choices[i]!.outcomePathType === 'meeting' ? 'other' : 'meeting',
                    };
                    setForm({ ...form, choices });
                  }}
                />
                {form.choices.length > 1 && (
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => setForm({ ...form, choices: form.choices.filter((_, j) => j !== i) })}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-secondary"
            style={{ marginTop: 10 }}
            onClick={() =>
              setForm({ ...form, choices: [...form.choices, { label: '', outcomePathType: 'meeting' }] })
            }
          >
            Add an answer
          </button>
        </div>
      )}

      <div style={{ margin: '18px 0' }}>
        <Toggle
          on={form.required}
          label="Required"
          onClick={() => setForm({ ...form, required: !form.required })}
        />
      </div>
    </>
  );
}

/** ~25s to answer any one question, rounded up — just enough to give a
 * prospect a fair "about N minutes" estimate, not a real timing study. */
function estimateMinutes(count: number): number {
  return Math.max(1, Math.ceil((count * 25) / 60));
}

/** The live customer preview: a truthful, static read of the questions step
 * exactly as BookingFlow renders it (same lede copy, same field order) —
 * see the note there if that copy ever changes, this should follow it. */
function QuestionsPreview({ questions }: { questions: Question[] }) {
  return (
    <div className="preview-mat">
      <div className="preview-card">
        <div className="preview-wordmark">intro</div>
        {questions.length === 0 ? (
          <p className="preview-empty">
            No questions yet — a prospect goes straight to the calendar after giving their email.
          </p>
        ) : (
          <>
            <p className="preview-lede">A few questions before we find a time.</p>
            {questions.map((q) => (
              <div key={q.id} className="preview-field">
                {q.prompt || 'Untitled question'}
              </div>
            ))}
            <div className="preview-meta">
              {questions.length} question{questions.length === 1 ? '' : 's'} · about{' '}
              {estimateMinutes(questions.length)} minute{estimateMinutes(questions.length) === 1 ? '' : 's'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ScreeningQuestionsPage() {
  const { slug } = useParams<{ slug: string }>();
  const base = `/api/admin/${slug}/questions`;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ questions: Question[] }>(base);
      setQuestions(result.questions);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slug is stable for the life of this page
  }, [slug]);

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminFetchJson(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(formToPayload(form)),
      });
      setForm(EMPTY_FORM);
      setCreating(false);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function submitEdit(event: React.FormEvent, id: string) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminFetchJson(`${base}/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(formToPayload(editForm)),
      });
      setEditingId(null);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleRequired(q: Question) {
    setError(null);
    setQuestions((prev) => prev.map((x) => (x.id === q.id ? { ...x, required: !x.required } : x)));
    try {
      await adminFetchJson(`${base}/${q.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ required: !q.required }),
      });
    } catch (cause) {
      setError((cause as Error).message);
      await load();
    }
  }

  async function move(id: string, direction: 'up' | 'down') {
    setError(null);
    try {
      const result = await adminFetchJson<{ questions: Question[] }>(`${base}/${id}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ direction }),
      });
      setQuestions(result.questions);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this question? This cannot be undone.')) return;
    setError(null);
    try {
      await adminFetchJson(`${base}/${id}`, { method: 'DELETE' });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <div className="builder-split">
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
          <div className="admin-card-title" style={{ marginBottom: 0 }}>
            Question builder
          </div>
          {!creating && (
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              Add question
            </button>
          )}
        </div>

        <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '0 0 6px', maxWidth: 560 }}>
          Everyone answers these on one page before any times are shown. Which answers send someone
          down a different path is set on the next step.
        </p>
        <a href={`/admin/${slug}/sessions`} className="btn-link" style={{ display: 'inline-block', marginBottom: 18 }}>
          See what's bookable →
        </a>

        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        {creating && (
          <form className="card" onSubmit={submitCreate} style={{ marginBottom: 14 }}>
            <div className="admin-card-title">New question</div>
            <QuestionForm form={form} setForm={setForm} idPrefix="new" />
            <div className="actions">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Add question'}
              </button>
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setCreating(false);
                  setForm(EMPTY_FORM);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {loading && <p className="status">Loading…</p>}

        {!loading && questions.length === 0 && !creating && (
          <p className="notice notice-muted">
            No questions yet — prospects go straight to the calendar until you add one.
          </p>
        )}

        <div className="admin-list">
          {questions.map((q, i) =>
            editingId === q.id ? (
              <form key={q.id} className="card" onSubmit={(e) => submitEdit(e, q.id)}>
                <QuestionForm form={editForm} setForm={setEditForm} idPrefix={`edit-${q.id}`} />
                <div className="actions">
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" className="btn-link" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div key={q.id} className="card admin-row">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button
                    type="button"
                    className="btn-link"
                    disabled={i === 0}
                    style={{ opacity: i === 0 ? 0.3 : 1 }}
                    onClick={() => move(q.id, 'up')}
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn-link"
                    disabled={i === questions.length - 1}
                    style={{ opacity: i === questions.length - 1 ? 0.3 : 1 }}
                    onClick={() => move(q.id, 'down')}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: '1.05rem' }}>{q.prompt}</h2>
                    <span style={{ fontSize: '0.8rem', color: 'var(--faint)' }}>
                      {KIND_LABEL[q.kind]}
                      {q.required ? ' · required' : ''}
                    </span>
                  </div>

                  {q.options.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                      {q.options.map((opt) => (
                        <span
                          key={opt.label}
                          className="notice"
                          style={{
                            padding: '4px 11px',
                            margin: 0,
                            background:
                              opt.outcomePathType === 'meeting' ? 'var(--status-live-tint)' : 'var(--accent-tint)',
                            color:
                              opt.outcomePathType === 'meeting' ? 'var(--status-live-ink)' : 'var(--accent-ink)',
                          }}
                        >
                          {opt.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setEditingId(q.id);
                      setEditForm(questionToForm(q));
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="btn-link" onClick={() => toggleRequired(q)}>
                    {q.required ? 'Make optional' : 'Make required'}
                  </button>
                  <button type="button" className="btn-link" onClick={() => remove(q.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      <div>
        <div className="preview-panel-label">Customer preview</div>
        <QuestionsPreview questions={questions} />
      </div>
    </div>
  );
}
