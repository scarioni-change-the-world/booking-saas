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
  /** null = asked for every service; set = only when booking that one
   * (migration 0016). Fixed at creation — moving a question between scopes
   * isn't supported yet; remove and re-add it in the right section. */
  eventTypeId: string | null;
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

interface EventTypeOption {
  id: string;
  name: string;
}

interface Draft {
  questions: Array<{ prompt: string; kind: Kind; required: boolean; options: Option[] }>;
  otherPathMessage: string;
}

/** A drafted question, in the same FormState shape QuestionForm already
 * edits — so reviewing a draft reuses the exact same editor manual entry
 * uses, rather than a second, parallel way to edit a question. */
function draftQuestionToForm(q: Draft['questions'][number]): FormState {
  return {
    prompt: q.prompt,
    kind: q.kind,
    required: q.required,
    yesNo: q.kind === 'yes_no' && q.options.length === 2 ? [q.options[0]!, q.options[1]!] : EMPTY_FORM.yesNo,
    choices: q.kind === 'single_choice' && q.options.length > 0 ? q.options : EMPTY_FORM.choices,
  };
}

/**
 * PRODUCT_VISION.md's "AI-assisted intake design": describe how you decide
 * who's ready to meet, get a draft to review. Nothing here saves anything
 * directly — "Add" on a drafted question calls the same POST /questions
 * route manual entry uses (via the same formToPayload every manually
 * created question already goes through), so there is exactly one path a
 * question is actually created through, and one editor (QuestionForm) for
 * every question whether it started as a draft or from scratch. Starts
 * collapsed: useful mainly for a first pass or a fresh service, not
 * something that should compete for space with the manual builder on
 * every visit.
 */
function AiSetupCard({
  slug,
  eventTypes,
  onQuestionsAdded,
}: {
  slug: string;
  eventTypes: EventTypeOption[];
  /** Which service (if any) the accepted questions were scoped to, so the
   * page can bring that service's section into view right away. */
  onQuestionsAdded: (eventTypeId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [eventTypeId, setEventTypeId] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftForms, setDraftForms] = useState<FormState[] | null>(null);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const [otherPathId, setOtherPathId] = useState<string | null>(null);
  const [otherPathAvailable, setOtherPathAvailable] = useState(false);
  const [otherPathMessage, setOtherPathMessage] = useState('');
  const [otherPathSaving, setOtherPathSaving] = useState(false);
  const [otherPathSaved, setOtherPathSaved] = useState(false);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setDraftForms(null);
    setRemoved(new Set());
    setEditingIndex(null);
    setOtherPathSaved(false);
    try {
      const result = await adminFetchJson<{ draft: Draft }>(
        `/api/admin/${slug}/ai/intake-draft`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ description, eventTypeId: eventTypeId || undefined }),
        },
      );
      setDraftForms(result.draft.questions.map(draftQuestionToForm));
      setOtherPathMessage(result.draft.otherPathMessage);
      setOtherPathAvailable(result.draft.otherPathMessage.trim() !== '');
      // The other outcome path is only fetched once a draft actually needs
      // one to save into — no reason to load it on every visit to this tab.
      if (!otherPathId) {
        const paths = await adminFetchJson<{ paths: Array<{ id: string; type: PathType }> }>(
          `/api/admin/${slug}/outcome-paths`,
        );
        setOtherPathId(paths.paths.find((p) => p.type === 'other')?.id ?? null);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function updateDraftForm(index: number, form: FormState) {
    setDraftForms((prev) => (prev ? prev.map((f, i) => (i === index ? form : f)) : prev));
  }

  async function addRemaining() {
    if (!draftForms) return;
    setAdding(true);
    setError(null);
    try {
      for (let i = 0; i < draftForms.length; i += 1) {
        if (removed.has(i)) continue;
        // Groundwork paying off: the service this draft was generated
        // about (if any) is exactly the scope the accepted questions land
        // in — same field, now a real save target instead of just prompt
        // context (migration 0016).
        await adminFetchJson(`/api/admin/${slug}/questions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...formToPayload(draftForms[i]!), eventTypeId: eventTypeId || undefined }),
        });
      }
      setDraftForms(null);
      setDescription('');
      onQuestionsAdded(eventTypeId || null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function useOtherPathMessage() {
    if (!otherPathId) return;
    setOtherPathSaving(true);
    setError(null);
    try {
      await adminFetchJson(`/api/admin/${slug}/outcome-paths/${otherPathId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: otherPathMessage }),
      });
      setOtherPathSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setOtherPathSaving(false);
    }
  }

  const remainingCount = draftForms ? draftForms.filter((_, i) => !removed.has(i)).length : 0;

  if (!open) {
    return (
      <button type="button" className="btn-secondary" style={{ marginBottom: 18 }} onClick={() => setOpen(true)}>
        AI-assisted setup
      </button>
    );
  }

  return (
    <form className="card" onSubmit={generate} style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="admin-card-title" style={{ marginBottom: 0 }}>
          AI-assisted setup
        </div>
        <button type="button" className="btn-link" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '6px 0 16px', maxWidth: 560 }}>
        Describe how you decide who&apos;s ready to work with you, and we&apos;ll draft a starting
        set of questions to review. Pick a service below to scope the accepted questions to just
        that one — leave it as &quot;No particular one&quot; and they&apos;ll apply to every service.
      </p>

      {eventTypes.length > 1 && (
        <div className="field">
          <label htmlFor="ai-event-type">Which service is this for?</label>
          <select id="ai-event-type" value={eventTypeId} onChange={(e) => setEventTypeId(e.target.value)}>
            <option value="">No particular one</option>
            {eventTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor="ai-description">Describe your service</label>
        <textarea
          id="ai-description"
          required
          placeholder="e.g. I'm a business coach. I only take on clients who can invest at least €500/month and want to start within 3 months."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="actions">
        <button type="submit" className="btn-primary" disabled={loading || !description.trim()}>
          {loading ? 'Drafting…' : 'Generate draft'}
        </button>
      </div>

      {draftForms && (
        <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
          <div className="admin-card-title">Draft — review before adding</div>
          <div className="admin-list">
            {draftForms.map((form, i) => {
              if (removed.has(i)) return null;
              const q = formToPayload(form);

              if (editingIndex === i) {
                return (
                  <div key={i} className="card">
                    <QuestionForm form={form} setForm={(f) => updateDraftForm(i, f)} idPrefix={`ai-draft-${i}`} />
                    <div className="actions">
                      <button type="button" className="btn-primary" onClick={() => setEditingIndex(null)}>
                        Done editing
                      </button>
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => {
                          setRemoved((prev) => new Set(prev).add(i));
                          setEditingIndex(null);
                        }}
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={i} className="card admin-row">
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, flexWrap: 'wrap' }}>
                      <h2 style={{ fontSize: '1.05rem' }}>{q.prompt || 'Untitled question'}</h2>
                      <span style={{ fontSize: '0.8rem', color: 'var(--faint)' }}>
                        {KIND_LABEL[q.kind]}
                        {q.required ? ' · required' : ''}
                      </span>
                    </div>
                    {q.options.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                        {q.options.map((opt, optIndex) => (
                          <span
                            key={`${opt.label}-${optIndex}`}
                            className="notice"
                            style={{
                              padding: '4px 11px',
                              margin: 0,
                              background:
                                opt.outcomePathType === 'meeting'
                                  ? 'var(--status-live-tint)'
                                  : 'var(--accent-tint)',
                              color:
                                opt.outcomePathType === 'meeting'
                                  ? 'var(--status-live-ink)'
                                  : 'var(--accent-ink)',
                            }}
                          >
                            {opt.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                    <button type="button" className="btn-secondary" onClick={() => setEditingIndex(i)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setRemoved((prev) => new Set(prev).add(i))}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {remainingCount > 0 && (
            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: 14 }}
              disabled={adding || editingIndex !== null}
              title={editingIndex !== null ? 'Finish editing first' : undefined}
              onClick={addRemaining}
            >
              {adding
                ? 'Adding…'
                : `Add ${remainingCount} question${remainingCount === 1 ? '' : 's'}`}
            </button>
          )}

          {otherPathAvailable && (
            <div style={{ marginTop: 20 }}>
              <label htmlFor="ai-other-path" style={{ display: 'block', fontWeight: 500, marginBottom: 9 }}>
                Suggested message for the other path
              </label>
              <textarea
                id="ai-other-path"
                value={otherPathMessage}
                onChange={(e) => setOtherPathMessage(e.target.value)}
              />
              <div className="actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={otherPathSaving || !otherPathId}
                  onClick={useOtherPathMessage}
                >
                  {otherPathSaving ? 'Saving…' : otherPathSaved ? 'Saved' : 'Use this message'}
                </button>
                <span style={{ fontSize: '0.82rem', color: 'var(--faint)' }}>
                  You can fine-tune this further on the Next steps tab.
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
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

/**
 * One question, in either its display row or its edit form — the same
 * block the flat list used to inline once, now shared between the "asked
 * for every service" section and the "asked only for {service}" one
 * (migration 0016) so the two don't drift into two slightly different
 * question rows over time.
 */
function QuestionRow({
  q,
  isFirst,
  isLast,
  editingId,
  editForm,
  setEditForm,
  saving,
  onEdit,
  onCancelEdit,
  onSubmitEdit,
  onMove,
  onToggleRequired,
  onRemove,
}: {
  q: Question;
  isFirst: boolean;
  isLast: boolean;
  editingId: string | null;
  editForm: FormState;
  setEditForm: (f: FormState) => void;
  saving: boolean;
  onEdit: (q: Question) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (event: React.FormEvent, id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onToggleRequired: (q: Question) => void;
  onRemove: (id: string) => void;
}) {
  if (editingId === q.id) {
    return (
      <form className="card" onSubmit={(e) => onSubmitEdit(e, q.id)}>
        <QuestionForm form={editForm} setForm={setEditForm} idPrefix={`edit-${q.id}`} />
        <div className="actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn-link" onClick={onCancelEdit}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="card admin-row">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button
          type="button"
          className="btn-link"
          disabled={isFirst}
          style={{ opacity: isFirst ? 0.3 : 1 }}
          onClick={() => onMove(q.id, 'up')}
          aria-label="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          className="btn-link"
          disabled={isLast}
          style={{ opacity: isLast ? 0.3 : 1 }}
          onClick={() => onMove(q.id, 'down')}
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
                  color: opt.outcomePathType === 'meeting' ? 'var(--status-live-ink)' : 'var(--accent-ink)',
                }}
              >
                {opt.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
        <button type="button" className="btn-secondary" onClick={() => onEdit(q)}>
          Edit
        </button>
        <button type="button" className="btn-link" onClick={() => onToggleRequired(q)}>
          {q.required ? 'Make optional' : 'Make required'}
        </button>
        <button type="button" className="btn-link" onClick={() => onRemove(q.id)}>
          Remove
        </button>
      </div>
    </div>
  );
}

export default function ScreeningQuestionsPage() {
  const { slug } = useParams<{ slug: string }>();
  const base = `/api/admin/${slug}/questions`;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [eventTypes, setEventTypes] = useState<EventTypeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Which service's own questions are showing alongside the shared ones —
  // '' means just the shared list (migration 0016). Hidden entirely for a
  // single-service tenant, where the distinction is moot.
  const [viewServiceId, setViewServiceId] = useState('');

  // Only one create form open at a time, and it knows which of the two
  // sections it belongs to — 'global' saves with no eventTypeId, 'service'
  // saves into viewServiceId.
  const [creatingScope, setCreatingScope] = useState<'none' | 'global' | 'service'>('none');
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
    // For the per-service section's own picker and the AI-assist panel's
    // "which service is this about" one — only prospect-facing services
    // are relevant, since existing clients never see the questionnaire at
    // all.
    adminFetchJson<{
      eventTypes: Array<{ id: string; name: string; active: boolean; availableToProspects: boolean }>;
    }>(`/api/admin/${slug}/event-types`)
      .then((result) =>
        setEventTypes(
          result.eventTypes
            .filter((t) => t.active && t.availableToProspects)
            .map((t) => ({ id: t.id, name: t.name })),
        ),
      )
      .catch(() => {
        // Non-critical: the AI panel just falls back to "no particular one".
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slug is stable for the life of this page
  }, [slug]);

  function startCreate(scope: 'global' | 'service') {
    setForm(EMPTY_FORM);
    setCreatingScope(scope);
  }

  function cancelCreate() {
    setCreatingScope('none');
    setForm(EMPTY_FORM);
  }

  async function submitCreate(event: React.FormEvent, eventTypeId: string | undefined) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminFetchJson(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...formToPayload(form), eventTypeId }),
      });
      setForm(EMPTY_FORM);
      setCreatingScope('none');
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(q: Question) {
    setEditingId(q.id);
    setEditForm(questionToForm(q));
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

  const globalQuestions = questions.filter((q) => q.eventTypeId === null);
  const serviceQuestions = viewServiceId ? questions.filter((q) => q.eventTypeId === viewServiceId) : [];
  const viewServiceName = eventTypes.find((t) => t.id === viewServiceId)?.name ?? '';
  // What a prospect booking the viewed service would actually be asked —
  // shared questions, then that service's own, same order the widget uses.
  const previewQuestions = viewServiceId ? [...globalQuestions, ...serviceQuestions] : globalQuestions;

  const rowProps = {
    editingId,
    editForm,
    setEditForm,
    saving,
    onEdit: startEdit,
    onCancelEdit: () => setEditingId(null),
    onSubmitEdit: submitEdit,
    onMove: move,
    onToggleRequired: toggleRequired,
    onRemove: remove,
  };

  return (
    <div className="builder-split">
      <div>
        <div className="admin-card-title" style={{ marginBottom: 6 }}>
          Question builder
        </div>
        <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '0 0 6px', maxWidth: 560 }}>
          Everyone answers the shared questions on one page before any times are shown. Which
          answers send someone down a different path is set on the next step.
        </p>
        <a href={`/admin/${slug}/sessions`} className="btn-link" style={{ display: 'inline-block', marginBottom: 18 }}>
          See what's bookable →
        </a>

        <div>
          <AiSetupCard
            slug={slug}
            eventTypes={eventTypes}
            onQuestionsAdded={(eventTypeId) => {
              void load();
              if (eventTypeId) setViewServiceId(eventTypeId);
            }}
          />
        </div>

        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        {loading && <p className="status">Loading…</p>}

        {!loading && (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 12,
                marginBottom: 6,
              }}
            >
              <div className="admin-card-title" style={{ marginBottom: 0 }}>
                Asked for every service
              </div>
              {creatingScope === 'none' && (
                <button type="button" className="btn-primary" onClick={() => startCreate('global')}>
                  Add question
                </button>
              )}
            </div>

            {creatingScope === 'global' && (
              <form className="card" onSubmit={(e) => submitCreate(e, undefined)} style={{ marginBottom: 14 }}>
                <div className="admin-card-title">New question</div>
                <QuestionForm form={form} setForm={setForm} idPrefix="new-global" />
                <div className="actions">
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Add question'}
                  </button>
                  <button type="button" className="btn-link" onClick={cancelCreate}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {globalQuestions.length === 0 && creatingScope !== 'global' && (
              <p className="notice notice-muted">
                No shared questions yet — prospects go straight to the calendar (or straight to a
                service's own questions, if it has any) until you add one.
              </p>
            )}

            <div className="admin-list" style={{ marginBottom: eventTypes.length > 1 ? 26 : 0 }}>
              {globalQuestions.map((q, i) => (
                <QuestionRow
                  key={q.id}
                  q={q}
                  isFirst={i === 0}
                  isLast={i === globalQuestions.length - 1}
                  {...rowProps}
                />
              ))}
            </div>

            {eventTypes.length > 1 && (
              <>
                <div className="field" style={{ maxWidth: 320 }}>
                  <label htmlFor="view-service">Also show one service&apos;s own questions</label>
                  <select
                    id="view-service"
                    value={viewServiceId}
                    onChange={(e) => {
                      setViewServiceId(e.target.value);
                      cancelCreate();
                    }}
                  >
                    <option value="">None</option>
                    {eventTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                {viewServiceId && (
                  <div style={{ marginTop: 18 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        gap: 12,
                        marginBottom: 6,
                      }}
                    >
                      <div className="admin-card-title" style={{ marginBottom: 0 }}>
                        Asked only for {viewServiceName}
                      </div>
                      {creatingScope === 'none' && (
                        <button type="button" className="btn-secondary" onClick={() => startCreate('service')}>
                          Add question
                        </button>
                      )}
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 10px' }}>
                      Shown after the shared questions above, only when someone books this service.
                    </p>

                    {creatingScope === 'service' && (
                      <form
                        className="card"
                        onSubmit={(e) => submitCreate(e, viewServiceId)}
                        style={{ marginBottom: 14 }}
                      >
                        <div className="admin-card-title">New question</div>
                        <QuestionForm form={form} setForm={setForm} idPrefix="new-service" />
                        <div className="actions">
                          <button type="submit" className="btn-primary" disabled={saving}>
                            {saving ? 'Saving…' : 'Add question'}
                          </button>
                          <button type="button" className="btn-link" onClick={cancelCreate}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}

                    {serviceQuestions.length === 0 && creatingScope !== 'service' && (
                      <p className="notice notice-muted">
                        No questions specific to {viewServiceName} yet — only the shared ones above apply.
                      </p>
                    )}

                    <div className="admin-list">
                      {serviceQuestions.map((q, i) => (
                        <QuestionRow
                          key={q.id}
                          q={q}
                          isFirst={i === 0}
                          isLast={i === serviceQuestions.length - 1}
                          {...rowProps}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div>
        <div className="preview-panel-label">Customer preview</div>
        <QuestionsPreview questions={previewQuestions} />
      </div>
    </div>
  );
}
