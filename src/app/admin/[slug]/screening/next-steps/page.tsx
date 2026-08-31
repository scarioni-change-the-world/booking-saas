'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';

type PathType = 'meeting' | 'other';

interface Option {
  label: string;
  outcomePathType: PathType;
}

interface Question {
  id: string;
  prompt: string;
  options: Option[];
}

interface OutcomePath {
  id: string;
  type: PathType;
  message: string;
  redirectUrl: string | null;
  redirectLabel: string | null;
}

interface OtherPathForm {
  message: string;
  redirectUrl: string;
  redirectLabel: string;
}

const EMPTY_OTHER_PATH: OtherPathForm = { message: '', redirectUrl: '', redirectLabel: '' };

/** Every option across every question, grouped by where it sends someone —
 * the actual routing rule read off live data, not restated by hand. A
 * question can hold both kinds of option (see brief 2.2's "Over 2.000 €"
 * vs "I can't afford this right now" on the same question), so this groups
 * by option, not by question. */
function groupOptions(questions: Question[]): { continues: Option[]; other: Option[] } {
  const continues: Option[] = [];
  const other: Option[] = [];
  for (const q of questions) {
    for (const opt of q.options) {
      (opt.outcomePathType === 'meeting' ? continues : other).push(opt);
    }
  }
  return { continues, other };
}

function LogicPreview({
  questions,
  otherPath,
}: {
  questions: Question[];
  otherPath: OtherPathForm;
}) {
  const { continues, other } = groupOptions(questions);
  const hasRouting = continues.length > 0 || other.length > 0;

  return (
    <div>
      {!hasRouting ? (
        <p className="preview-empty">
          No yes/no or multiple-choice question has answers yet — add one on the Questions step to
          see the routing here.
        </p>
      ) : (
        <>
          <div className="logic-card continues">
            <div className="logic-card-bar" />
            <div>
              <div className="logic-card-title">Continues to the calendar</div>
              {continues.length === 0 ? (
                <p className="preview-empty" style={{ margin: 0 }}>
                  Nothing currently continues — every answer sends someone down the other path.
                </p>
              ) : (
                continues.map((opt, i) => (
                  <span className="logic-chip" key={`${opt.label}-${i}`}>
                    {opt.label}
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="logic-card other">
            <div className="logic-card-bar" />
            <div>
              <div className="logic-card-title">Sent down the other path</div>
              {other.length === 0 ? (
                <p className="preview-empty" style={{ margin: 0 }}>
                  Nothing currently does — every answer continues to the calendar.
                </p>
              ) : (
                other.map((opt, i) => (
                  <span className="logic-chip" key={`${opt.label}-${i}`}>
                    {opt.label}
                  </span>
                ))
              )}
            </div>
          </div>
        </>
      )}

      <div className="preview-mat" style={{ marginTop: 14 }}>
        <div className="preview-card">
          <div className="preview-wordmark">intro</div>
          {otherPath.message.trim() === '' ? (
            <p className="preview-empty">What the other path says will preview here as you type.</p>
          ) : (
            <>
              <p style={{ margin: '0 0 14px', whiteSpace: 'pre-wrap', fontSize: '0.92rem' }}>
                {otherPath.message}
              </p>
              {otherPath.redirectUrl && (
                <div className="preview-field" style={{ textAlign: 'center', color: 'var(--accent-ink)' }}>
                  {otherPath.redirectLabel || 'Learn more'}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NextStepsPage() {
  const { slug } = useParams<{ slug: string }>();
  const pathsUrl = `/api/admin/${slug}/outcome-paths`;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [otherPathId, setOtherPathId] = useState<string | null>(null);
  const [otherPath, setOtherPath] = useState<OtherPathForm>(EMPTY_OTHER_PATH);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [{ questions: qs }, { paths }] = await Promise.all([
          adminFetchJson<{ questions: Question[] }>(`/api/admin/${slug}/questions`),
          adminFetchJson<{ paths: OutcomePath[] }>(pathsUrl),
        ]);
        if (cancelled) return;
        setQuestions(qs);
        const other = paths.find((p) => p.type === 'other');
        if (other) {
          setOtherPathId(other.id);
          setOtherPath({
            message: other.message,
            redirectUrl: other.redirectUrl ?? '',
            redirectLabel: other.redirectLabel ?? '',
          });
        }
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slug/pathsUrl stable for the life of this page
  }, [slug]);

  async function submitOtherPath(event: React.FormEvent) {
    event.preventDefault();
    if (!otherPathId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await adminFetchJson(`${pathsUrl}/${otherPathId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: otherPath.message,
          redirectUrl: otherPath.redirectUrl || null,
          redirectLabel: otherPath.redirectLabel || null,
        }),
      });
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="builder-split">
      <div>
        <div className="admin-card-title" style={{ color: 'var(--emphasis)' }}>
          Next-step rules
        </div>
        <h2 style={{ fontSize: '1.3rem', margin: '0 0 8px' }}>Decide what happens after the answers.</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '0 0 20px', maxWidth: 560 }}>
          Which answer sends someone down which path is set per-answer on the Questions step. This
          is where you write what the other path actually says.
        </p>

        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        {loading && <p className="status">Loading…</p>}

        {!loading && otherPathId && (
          <form className="card" onSubmit={submitOtherPath}>
            <div className="admin-card-title">Where the other path leads</div>
            <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '-4px 0 16px', maxWidth: 560 }}>
              What someone sees when an answer sends them here instead of the calendar.
            </p>

            <div className="field">
              <label htmlFor="other-path-message">Message</label>
              <textarea
                id="other-path-message"
                value={otherPath.message}
                onChange={(e) => setOtherPath({ ...otherPath, message: e.target.value })}
              />
            </div>

            <div className="admin-field-row">
              <div className="field">
                <label htmlFor="other-path-url">Send them here instead (optional)</label>
                <input
                  id="other-path-url"
                  type="url"
                  placeholder="https://…"
                  value={otherPath.redirectUrl}
                  onChange={(e) => setOtherPath({ ...otherPath, redirectUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="other-path-label">Link text</label>
                <input
                  id="other-path-label"
                  type="text"
                  placeholder="Learn more"
                  value={otherPath.redirectLabel}
                  onChange={(e) => setOtherPath({ ...otherPath, redirectLabel: e.target.value })}
                />
              </div>
            </div>

            <div className="actions">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              {saved && !saving && (
                <span style={{ fontSize: '0.85rem', color: 'var(--status-live-ink)' }}>Saved</span>
              )}
            </div>
          </form>
        )}
      </div>

      <div>
        <div className="preview-panel-label">Live logic preview</div>
        {!loading && <LogicPreview questions={questions} otherPath={otherPath} />}
      </div>
    </div>
  );
}
