'use client';

import Toggle from '@/components/admin/Toggle';

/**
 * One question's editor, shared by the Questions page and a service's own
 * Questions tab, so both offer the same thing: the words, the kind of
 * answer, and for each answer whether the person goes on to book or is sent
 * to your next steps instead. Two copies of this are how the service tab
 * once lost the routing without anyone deciding it should.
 */

export type Kind = 'text' | 'yes_no' | 'single_choice';
export type PathType = 'meeting' | 'other';

export interface Option {
  label: string;
  outcomePathType: PathType;
}

export interface Question {
  id: string;
  prompt: string;
  kind: Kind;
  options: Option[];
  required: boolean;
  sortOrder: number;
  /** null = asked for every service; set = only when booking that one
   * (migration 0016). Fixed at creation. */
  eventTypeId: string | null;
}

export interface FormState {
  prompt: string;
  kind: Kind;
  required: boolean;
  yesNo: [Option, Option];
  choices: Option[];
}

export const EMPTY_FORM: FormState = {
  prompt: '',
  kind: 'text',
  required: true,
  yesNo: [
    { label: 'Yes', outcomePathType: 'meeting' },
    { label: 'No', outcomePathType: 'meeting' },
  ],
  choices: [{ label: '', outcomePathType: 'meeting' }],
};

export const KIND_LABEL: Record<Kind, string> = {
  text: 'Free text',
  yes_no: 'Yes / no',
  single_choice: 'Choose one',
};

/** Where an answer leads, said plainly on its switch. */
const PATH_LABEL: Record<PathType, string> = {
  meeting: 'Goes on to book',
  other: 'Sent to your next steps',
};

export function formToPayload(form: FormState) {
  return {
    prompt: form.prompt,
    kind: form.kind,
    required: form.required,
    options: form.kind === 'yes_no' ? form.yesNo : form.kind === 'single_choice' ? form.choices : [],
  };
}

export function questionToForm(q: Question): FormState {
  return {
    prompt: q.prompt,
    kind: q.kind,
    required: q.required,
    yesNo: q.kind === 'yes_no' && q.options.length === 2 ? [q.options[0]!, q.options[1]!] : EMPTY_FORM.yesNo,
    choices: q.kind === 'single_choice' && q.options.length > 0 ? q.options : EMPTY_FORM.choices,
  };
}

/** What a question's row says under it: the kind, and where answers lead. */
export function questionSummary(q: Pick<Question, 'kind' | 'required' | 'options'>): string {
  const parts = [KIND_LABEL[q.kind], q.required ? 'required' : 'optional'];
  if (q.options.length > 0) {
    const elsewhere = q.options.filter((o) => o.outcomePathType !== 'meeting').length;
    if (q.kind === 'single_choice') parts.push(`${q.options.length} answers`);
    if (elsewhere > 0) parts.push(`${elsewhere} ${elsewhere === 1 ? 'answer sends' : 'answers send'} people elsewhere`);
  }
  return parts.join(' · ');
}

/** True when any answer of the form leads away from the calendar. */
export function routesElsewhere(form: FormState): boolean {
  return formToPayload(form).options.some((o) => o.outcomePathType === 'other');
}

const flip = (o: Option): Option => ({ ...o, outcomePathType: o.outcomePathType === 'meeting' ? 'other' : 'meeting' });

export function QuestionForm({
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
          maxLength={500}
          value={form.prompt}
          onChange={(e) => setForm({ ...form, prompt: e.target.value })}
        />
      </div>

      <div className="field">
        <label id={`${idPrefix}-kind`}>Type of answer</label>
        <div className="wk-mode qf-kind" role="group" aria-labelledby={`${idPrefix}-kind`}>
          {(Object.keys(KIND_LABEL) as Kind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className="filter-chip"
              aria-pressed={form.kind === kind}
              onClick={() => setForm({ ...form, kind })}
            >
              {KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      </div>

      {form.kind === 'text' && (
        <p className="notice notice-muted">
          A written answer reaches you with the booking. It never decides who can book: there is no reliable way
          to judge it automatically.
        </p>
      )}

      {form.kind === 'yes_no' && (
        <div className="field">
          <label>Where each answer leads</label>
          <div className="qf-answers">
            {form.yesNo.map((opt, i) => (
              <div key={opt.label} className="qf-answer">
                <span className="qf-answer-label">{opt.label}</span>
                <Toggle
                  on={opt.outcomePathType === 'meeting'}
                  label={PATH_LABEL[opt.outcomePathType]}
                  onClick={() => {
                    const yesNo = [...form.yesNo] as [Option, Option];
                    yesNo[i] = flip(yesNo[i]!);
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
          <label>Answers, and where each leads</label>
          <div className="qf-answers">
            {form.choices.map((opt, i) => (
              <div key={i} className="qf-answer">
                <input
                  type="text"
                  placeholder={`Answer ${i + 1}`}
                  aria-label={`Answer ${i + 1}`}
                  value={opt.label}
                  onChange={(e) => {
                    const choices = [...form.choices];
                    choices[i] = { ...choices[i]!, label: e.target.value };
                    setForm({ ...form, choices });
                  }}
                />
                <Toggle
                  on={opt.outcomePathType === 'meeting'}
                  label={PATH_LABEL[opt.outcomePathType]}
                  onClick={() => {
                    const choices = [...form.choices];
                    choices[i] = flip(choices[i]!);
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
            className="btn-secondary qf-more"
            onClick={() => setForm({ ...form, choices: [...form.choices, { label: '', outcomePathType: 'meeting' }] })}
          >
            Add an answer
          </button>
        </div>
      )}

      <div className="qf-required">
        <Toggle on={form.required} label="Must be answered" onClick={() => setForm({ ...form, required: !form.required })} />
      </div>
    </>
  );
}
