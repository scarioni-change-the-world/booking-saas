'use client';

import { useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';
import { replay, routingChanged, type Capacity, type ReplayQuestion, type ReplayResponse } from '@/lib/replay';
import {
  EMPTY_FORM,
  KIND_LABEL,
  QuestionForm,
  formToPayload,
  type FormState,
  type Kind,
  type Option,
  type PathType,
  type Question,
} from '@/components/admin/QuestionForm';

/*
 * The two helpers beside a service's questions: drafting them with khloe
 * from a description, and replaying last month's answers under a rule
 * before it is saved.
 */

export interface EventTypeOption {
  id: string;
  name: string;
  /**
   * Whether new enquiries are offered this at all.
   *
   * Kept rather than filtered on. The picker used to drop everything that
   * was not prospect-facing, which made the documented setup order
   * impossible to follow: questions are the second thing you decide about
   * a service and going live is the last, so a service you are in the
   * middle of setting up was never in the list you were sent to. It is
   * listed now, and the page says plainly that nobody is being asked yet.
   */
  availableToProspects: boolean;
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
export function AiSetupCard({
  slug,
  eventTypes,
  onQuestionsAdded,
  defaultServiceId,
}: {
  slug: string;
  eventTypes: EventTypeOption[];
  /** Drafting from a service's own page: its questions, unless changed. */
  defaultServiceId?: string;
  /** Which service (if any) the accepted questions were scoped to, so the
   * page can bring that service's section into view right away. */
  onQuestionsAdded: (eventTypeId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [eventTypeId, setEventTypeId] = useState(defaultServiceId ?? '');
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
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        Draft them with khloe
      </button>
    );
  }

  return (
    <form className="card" onSubmit={generate} style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="admin-card-title" style={{ marginBottom: 0 }}>
          Draft them with khloe
        </div>
        <button type="button" className="btn-link" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '6px 0 16px', maxWidth: 560 }}>
        Describe how you decide who&apos;s ready to work with you, and we&apos;ll draft a starting
        set of questions to review, with where each answer leads. Nothing is added until you say so.
      </p>

      {/* > 0, not > 1: the paragraph above promises "pick a service below",
          and above a single service the control it promises was not
          rendered — the copy describing a thing that is not on screen. */}
      {eventTypes.length > 0 && (
        <div className="field">
          <label htmlFor="ai-event-type">Which service is this for?</label>
          <select id="ai-event-type" value={eventTypeId} onChange={(e) => setEventTypeId(e.target.value)}>
            <option value="">Every service</option>
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
                  You can fine-tune it, and see it as they will, on Messages.
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

export interface ReplayData {
  responses: ReplayResponse[];
  capacity: Capacity;
}

function toReplayQuestion(q: Question): ReplayQuestion {
  return { id: q.id, kind: q.kind, options: q.options };
}

function draftQuestion(id: string, form: FormState): ReplayQuestion {
  return {
    id,
    kind: form.kind,
    options: form.kind === 'yes_no' ? form.yesNo : form.kind === 'single_choice' ? form.choices : [],
  };
}

function hoursLabel(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h} h`;
}

/**
 * Last month's answers, replayed under the rule being edited — beside the
 * toggles, updating on every flip, before anything is saved. See
 * src/lib/replay.ts for how, and why it compares against today's rules
 * rather than against what happened.
 */
export function ReplayPanel({
  saved,
  form,
  questions,
  data,
}: {
  saved: Question;
  form: FormState;
  questions: Question[];
  data: ReplayData | null | 'unavailable';
}) {
  if (form.kind === 'text') {
    return (
      <aside className="rp">
        <p className="wk-side-eyebrow">Last 30 days, with this rule</p>
        <p className="rp-note">A free-text answer never sends anyone anywhere, so nothing would change.</p>
      </aside>
    );
  }
  if (data === 'unavailable') {
    return (
      <aside className="rp">
        <p className="wk-side-eyebrow">Last 30 days, with this rule</p>
        <p className="rp-note">Last month’s answers could not be loaded, so this change cannot be tried out here.</p>
      </aside>
    );
  }
  if (!data) {
    return (
      <aside className="rp">
        <p className="rp-note">Replaying last month’s answers…</p>
      </aside>
    );
  }

  const draft = draftQuestion(saved.id, form);
  const changed = routingChanged(toReplayQuestion(saved), draft);
  const result = replay(data.responses, questions.map(toReplayQuestion), draft, data.capacity);

  if (result.answered === 0) {
    return (
      <aside className="rp">
        <p className="wk-side-eyebrow">Last 30 days, with this rule</p>
        <p className="rp-note">
          Nobody new answered this question in the last 30 days, so there is nothing to replay yet.
        </p>
      </aside>
    );
  }

  const bookingsAfter = result.bookingsBefore - result.bookingsLost + result.bookingsGained;
  const row = (label: string, before: number, after: number, approx = false) => {
    const delta = after - before;
    return (
      <div className="rp-row">
        <span>{label}</span>
        <span className="rp-figures">
          {before}
          {changed && (
            <>
              <span aria-hidden="true"> → </span>
              <span className="sr-only"> would become </span>
              <b>
                {approx && delta !== 0 ? 'about ' : ''}
                {after}
              </b>
              {delta !== 0 && <small className={delta > 0 ? 'is-up' : 'is-down'}>{delta > 0 ? `+${delta}` : delta}</small>}
            </>
          )}
        </span>
      </div>
    );
  };

  const cap = result.capacity;
  const usedAfter = cap ? (changed ? cap.usedAfter : cap.usedBefore) : 0;

  return (
    <aside className="rp" aria-live="polite">
      <div className="rp-head">
        <p className="wk-side-eyebrow">Last 30 days, with this rule</p>
        <span className={`rp-state${changed ? ' is-changed' : ''}`}>{changed ? 'Not saved yet' : 'Same as now'}</span>
      </div>
      <p className="rp-note">
        {result.answered} new {result.answered === 1 ? 'person was' : 'people were'} asked this. Replayed
        {changed ? ' with your change' : ''}:
      </p>
      {row('Reach your calendar', result.before.calendar, result.after.calendar)}
      {row('Sent elsewhere', result.before.elsewhere, result.after.elsewhere)}
      {row('Bookings', result.bookingsBefore, bookingsAfter, true)}

      {changed && result.bookingsLost > 0 && (
        <p className="wk-warning">
          {result.bookingsLost === 1
            ? '1 real booking last month came from someone this rule would now send elsewhere.'
            : `${result.bookingsLost} real bookings last month came from people this rule would now send elsewhere.`}
        </p>
      )}
      {changed && result.nowLetThrough > 0 && (
        <p className="rp-note">
          {result.nowLetThrough} more would have reached your calendar. At last month’s rate — about{' '}
          {Math.round(result.bookingRate * 100)}% of people let through went on to book — that is about{' '}
          {result.bookingsGained} more {result.bookingsGained === 1 ? 'booking' : 'bookings'}.
        </p>
      )}

      {cap && (
        <div className="rp-cap">
          <div className="rp-bar" role="img" aria-label={`${hoursLabel(usedAfter)} of ${hoursLabel(cap.openMinutes)} open hours used`}>
            <i style={{ width: `${Math.min(100, (usedAfter / cap.openMinutes) * 100)}%` }} className={cap.shortBy > 0 && changed ? 'is-over' : undefined} />
          </div>
          <p className="rp-note">
            {changed && cap.shortBy > 0
              ? `About ${hoursLabel(cap.shortBy)} more than your open hours: the month would not have had room for everyone.`
              : `${hoursLabel(usedAfter)} of ${hoursLabel(cap.openMinutes)} open hours used. Room for everyone.`}
          </p>
        </div>
      )}

      <p className="rp-small">
        New enquiries who were asked this question. Worked out with your other questions as they are today,
        so only this change is measured.
      </p>
    </aside>
  );
}

