'use client';

import { useEffect, useState } from 'react';

export interface Setting {
  id: string;
  label: string;
  /** The current value, as it reads: "60 min", "Online", "Not set". */
  value: string;
  /** Nothing yet: the value reads quieter. */
  empty?: boolean;
  /** Needed before people can book: the Ochre dot. */
  needed?: boolean;
  /** The editor, shown when this setting is chosen. */
  editor: React.ReactNode;
}

const NARROW = '(max-width: 760px)';

/**
 * A group of settings, read and changed like the controls of a well-made
 * device: every setting is one line with its current value, so the whole
 * thing reads at a glance; the chosen one is edited beside the list, and
 * nothing else moves. On a phone there is no "beside", so the chosen one
 * opens in place, under its own line.
 *
 * Each editor saves only its own setting.
 */
export function SettingsPanel({
  label,
  settings,
  initial,
}: {
  label: string;
  settings: Setting[];
  /** Which setting is open on a wide screen to begin with. */
  initial?: string;
}) {
  const [narrow, setNarrow] = useState(false);
  const firstNeeded = settings.find((s) => s.needed)?.id;
  const [chosen, setChosen] = useState<string | null>(initial ?? firstNeeded ?? settings[0]?.id ?? null);

  useEffect(() => {
    const media = window.matchMedia(NARROW);
    const update = () => setNarrow(media.matches);
    update();
    // On a phone nothing starts open, unless it needs the person.
    if (media.matches) setChosen(initial ?? firstNeeded ?? null);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = settings.find((s) => s.id === chosen) ?? null;
  const choose = (id: string) => setChosen((c) => (narrow && c === id ? null : id));

  return (
    <section className="sp" aria-label={label}>
      <ul className="sp-list">
        {settings.map((s) => {
          const isOpen = s.id === chosen;
          return (
            <li key={s.id} className={`sp-item${isOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className="sp-row"
                aria-expanded={narrow ? isOpen : undefined}
                aria-current={!narrow && isOpen ? 'true' : undefined}
                aria-controls={`sp-edit-${s.id}`}
                onClick={() => choose(s.id)}
              >
                <span className="sp-label">
                  {s.label}
                  {s.needed && <span className="svc-tab-dot" aria-label="(needed)" />}
                </span>
                <span className={`sp-value${s.empty ? ' is-empty' : ''}`}>{s.value}</span>
                <span className="sp-go" aria-hidden="true">
                  {narrow ? (isOpen ? '▴' : '▾') : '›'}
                </span>
              </button>
              {narrow && isOpen && (
                <div className="sp-edit is-inline" id={`sp-edit-${s.id}`}>
                  {s.editor}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!narrow && (
        <div className="sp-edit" id={open ? `sp-edit-${open.id}` : undefined} aria-live="polite">
          {open ? (
            <>
              <p className="sp-edit-title">{open.label}</p>
              {/* Keyed, so switching settings starts each editor from what is saved. */}
              <div key={open.id}>{open.editor}</div>
            </>
          ) : (
            <p className="sp-hint">Choose a setting to change it.</p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One setting's editor: a sentence on what it is for, the control, and a
 * Save that is only live once something changed. "Saved." stays until the
 * next change.
 */
export function SettingForm({
  purpose,
  dirty,
  save,
  children,
}: {
  purpose?: React.ReactNode;
  dirty: boolean;
  save: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);

  return (
    <form
      className="sp-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await save();
          setSaved(true);
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {purpose && <p className="sp-purpose">{purpose}</p>}
      {children}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="sp-keys">
        <button type="submit" className="btn-primary" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved && !dirty && <span className="ms-saved">Saved.</span>}
      </div>
    </form>
  );
}
