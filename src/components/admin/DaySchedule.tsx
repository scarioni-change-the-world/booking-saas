'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { adminFetchJson } from '@/lib/admin-fetch';
import { windowsForDate } from '@/lib/availability';
import { minutesToTimeLabel, parseTimeToMinutes } from '@/lib/blocked-slots';

interface Rule {
  weekday: number;
  startTime: string;
  endTime: string;
}

interface Override {
  id: string;
  date: string;
  isClosed: boolean;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
}

interface Block {
  id: string;
  startMinutes: number;
  endMinutes: number;
  reason: string | null;
}

interface Cell {
  startMinutes: number;
  endMinutes: number;
  /** Usually 0 or 1 id; more than one only if blocks were created overlapping. */
  blockIds: string[];
}

/** Not user-configurable in v1 — every block this UI creates lands on a
 * 30-minute boundary, same as the booking widget's own slot picker, so the
 * two always feel like the same clock. */
const CELL_MINUTES = 30;
/** How long the undo banner stays up before it quietly goes away. */
const UNDO_TIMEOUT_MS = 8000;

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function todayIso(): string {
  return DateTime.now().toFormat('yyyy-MM-dd');
}

/** The day's open wall-clock windows, in minutes since midnight — reuses the
 * exact rule the slot engine itself uses (windowsForDate), so "what's open"
 * never drifts between the booking widget and this grid. */
function windowsForSelectedDate(
  dateIso: string,
  rules: readonly Rule[],
  overrides: readonly Override[],
): Array<{ startMinutes: number; endMinutes: number }> {
  const date = DateTime.fromISO(dateIso);
  if (!date.isValid) return [];
  const overrideMap = new Map(overrides.map((o) => [o.date, o]));
  return windowsForDate(date, rules, overrideMap)
    .map((w) => ({
      startMinutes: parseTimeToMinutes(w.startTime),
      endMinutes: parseTimeToMinutes(w.endTime),
    }))
    .filter((w) => w.endMinutes > w.startMinutes);
}

function buildCells(window: { startMinutes: number; endMinutes: number }, blocks: Block[]): Cell[] {
  const cells: Cell[] = [];
  for (let start = window.startMinutes; start < window.endMinutes; start += CELL_MINUTES) {
    const end = Math.min(start + CELL_MINUTES, window.endMinutes);
    const blockIds = blocks.filter((b) => b.startMinutes < end && b.endMinutes > start).map((b) => b.id);
    cells.push({ startMinutes: start, endMinutes: end, blockIds });
  }
  return cells;
}

/**
 * One open window, rendered as a column of half-hour cells — click, drag
 * across several, or use the keyboard.
 *
 * Every cell is a real <button>: Tab reaches it, arrow keys move focus
 * between cells in this window, Space/Enter blocks or reopens whichever one
 * has focus. That keyboard path is deliberately single-cell-at-a-time —
 * mouse users get the fast multi-cell drag, keyboard users get a slower but
 * always-available way to do the same thing, rather than no way at all.
 *
 * The two input paths don't share an activation event on purpose: pointer
 * interaction is handled entirely by the container (pointerdown/move/up —
 * index arithmetic on the pointer's Y position, captured on pointerdown so a
 * fast drag doesn't skip cells), and keyboard interaction is handled entirely
 * by each button's own onKeyDown. Neither path defines onClick, so there is
 * no native click event to disambiguate from a drag.
 */
function WindowGrid({
  cells,
  busy,
  onBlockRange,
  onUnblockRange,
}: {
  cells: Cell[];
  busy: boolean;
  onBlockRange: (startMinutes: number, endMinutes: number) => void;
  onUnblockRange: (startMinutes: number, endMinutes: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [mode, setMode] = useState<'block' | 'unblock' | null>(null);

  function indexAtY(clientY: number): number {
    const el = containerRef.current;
    if (!el || cells.length === 0) return 0;
    const rect = el.getBoundingClientRect();
    const rowHeight = rect.height / cells.length;
    const raw = Math.floor((clientY - rect.top) / rowHeight);
    return Math.max(0, Math.min(cells.length - 1, raw));
  }

  /** Stop a selection the moment it would cross from open into blocked
   * cells, or vice versa — a drag stays one mode from anchor to release. */
  function clampToRun(from: number, to: number, wantBlocked: boolean): number {
    const step = to >= from ? 1 : -1;
    let i = from;
    while (i !== to + step) {
      const isBlocked = cells[i]!.blockIds.length > 0;
      if (isBlocked !== wantBlocked) return i - step;
      i += step;
    }
    return to;
  }

  function activateCell(index: number) {
    if (busy) return;
    const cell = cells[index];
    if (!cell) return;
    if (cell.blockIds.length > 0) {
      onUnblockRange(cell.startMinutes, cell.endMinutes);
    } else {
      onBlockRange(cell.startMinutes, cell.endMinutes);
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (busy || cells.length === 0) return;
    const index = indexAtY(event.clientY);
    const startingMode = cells[index]!.blockIds.length > 0 ? 'unblock' : 'block';
    containerRef.current?.setPointerCapture(event.pointerId);
    setMode(startingMode);
    setAnchor(index);
    setDragEnd(index);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (anchor === null || mode === null) return;
    setDragEnd(clampToRun(anchor, indexAtY(event.clientY), mode === 'unblock'));
  }

  function commitSelection() {
    if (anchor === null || dragEnd === null || mode === null) return;
    const start = Math.min(anchor, dragEnd);
    const end = Math.max(anchor, dragEnd);
    const startMinutes = cells[start]!.startMinutes;
    const endMinutes = cells[end]!.endMinutes;
    if (mode === 'block') {
      onBlockRange(startMinutes, endMinutes);
    } else {
      onUnblockRange(startMinutes, endMinutes);
    }
    setAnchor(null);
    setDragEnd(null);
    setMode(null);
  }

  function cancelSelection() {
    setAnchor(null);
    setDragEnd(null);
    setMode(null);
  }

  function handleCellKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      cellRefs.current[index + 1]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      cellRefs.current[index - 1]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateCell(index);
    }
  }

  const selectedRange: [number, number] | null =
    anchor !== null && dragEnd !== null ? [Math.min(anchor, dragEnd), Math.max(anchor, dragEnd)] : null;

  return (
    <div
      ref={containerRef}
      className="block-window"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={commitSelection}
      onPointerCancel={cancelSelection}
    >
      {cells.map((cell, i) => {
        const blocked = cell.blockIds.length > 0;
        const selecting = selectedRange !== null && i >= selectedRange[0] && i <= selectedRange[1];
        const className = [
          'block-cell',
          blocked && 'blocked',
          selecting && mode === 'block' && 'selecting',
          selecting && mode === 'unblock' && 'unselecting',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={cell.startMinutes}
            ref={(el) => {
              cellRefs.current[i] = el;
            }}
            type="button"
            className={className}
            aria-pressed={blocked}
            aria-label={`${minutesToTimeLabel(cell.startMinutes)} to ${minutesToTimeLabel(cell.endMinutes)}, ${blocked ? 'blocked' : 'open'}`}
            onKeyDown={(e) => handleCellKeyDown(e, i)}
          >
            <span aria-hidden="true">
              {minutesToTimeLabel(cell.startMinutes)} – {minutesToTimeLabel(cell.endMinutes)}
            </span>
            {blocked && (
              <span className="block-cell-badge" aria-hidden="true">
                Blocked
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Seven days centred on the selected one — enough to see what's around
 * today without a full month calendar. A dot means this date's hours differ
 * from the usual weekly schedule (closed, or special hours); it doesn't
 * distinguish that from an ad hoc block, on purpose — "look here" is the
 * whole job of the mark, not a taxonomy of why. */
function DayStrip({
  date,
  overrides,
  onSelect,
}: {
  date: string;
  overrides: Override[];
  onSelect: (date: string) => void;
}) {
  const selected = DateTime.fromISO(date);
  const start = selected.minus({ days: 3 });
  const today = todayIso();
  const overrideDates = useMemo(() => new Set(overrides.map((o) => o.date)), [overrides]);

  return (
    <div className="day-strip">
      {Array.from({ length: 7 }, (_, i) => start.plus({ days: i })).map((day) => {
        const iso = day.toFormat('yyyy-MM-dd');
        const classes = [
          'day-strip-day',
          iso === date && 'selected',
          iso === today && 'today',
          overrideDates.has(iso) && 'has-exception',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button key={iso} type="button" className={classes} onClick={() => onSelect(iso)}>
            <span className="weekday">{WEEKDAY_SHORT[day.weekday - 1]}</span>
            <span className="daynum">{day.day}</span>
            <span className="dot" />
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  slug: string;
  rules: Rule[];
}

/**
 * The day editor — everything about "how is this date different from a
 * usual week" in one place: closing it outright, giving it special hours,
 * or blocking an ad hoc stretch. These used to be two separate cards
 * (Exceptions, Block time) with two separate date pickers that didn't know
 * about each other; this is the merge, on the reasoning that they're the
 * same question ("what happens on this date?") at different granularities,
 * not two different features.
 *
 * Blocking and reopening are instant — no confirm step — with a brief undo
 * banner instead. Closing a day or setting special hours stays a deliberate,
 * confirmed action (its own inline form): rarer, more consequential, and
 * already gated to admins server-side, unlike day-to-day blocking.
 */
export default function DaySchedule({ slug, rules }: Props) {
  const blocksBase = `/api/admin/${slug}/blocked-slots`;
  const overridesBase = `/api/admin/${slug}/date-overrides`;

  const [date, setDate] = useState(todayIso());
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [undo, setUndo] = useState<{ message: string; snapshot: Block[] } | null>(null);
  const [editingReasonId, setEditingReasonId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');

  const [exceptionForm, setExceptionForm] = useState<'closed' | 'special' | null>(null);
  const [specialStart, setSpecialStart] = useState('09:00');
  const [specialEnd, setSpecialEnd] = useState('17:00');
  const [exceptionNote, setExceptionNote] = useState('');
  const [savingException, setSavingException] = useState(false);

  const isPast = date < todayIso();
  const currentOverride = overrides.find((o) => o.date === date) ?? null;
  const windows = useMemo(() => windowsForSelectedDate(date, rules, overrides), [date, rules, overrides]);
  const cellsByWindow = useMemo(() => windows.map((w) => buildCells(w, blocks)), [windows, blocks]);
  const usualHours = rules.filter((r) => r.weekday === (DateTime.fromISO(date).weekday || 1));

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [o, b] = await Promise.all([
        adminFetchJson<{ overrides: Override[] }>(overridesBase),
        adminFetchJson<{ blocks: Block[] }>(`${blocksBase}?date=${date}`),
      ]);
      setOverrides(o.overrides);
      setBlocks(b.blocks);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setUndo(null);
    setExceptionForm(null);
    setEditingReasonId(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bases are stable for the life of this component
  }, [date]);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  function shiftDate(days: number) {
    setDate(DateTime.fromISO(date).plus({ days }).toFormat('yyyy-MM-dd'));
  }

  /** Every block/unblock/remove action follows the same shape: snapshot the
   * day, act, reload, then offer undo against that snapshot. */
  async function withUndo(action: () => Promise<void>, message: string) {
    const snapshot = blocks;
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      setUndo({ message, snapshot });
    } catch (cause) {
      setError((cause as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  function blockRange(startMinutes: number, endMinutes: number) {
    void withUndo(async () => {
      await adminFetchJson(blocksBase, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date,
          startTime: minutesToTimeLabel(startMinutes),
          endTime: minutesToTimeLabel(endMinutes),
        }),
      });
    }, `Blocked ${minutesToTimeLabel(startMinutes)}–${minutesToTimeLabel(endMinutes)}`);
  }

  function unblockRange(startMinutes: number, endMinutes: number) {
    void withUndo(async () => {
      await adminFetchJson(`${blocksBase}/unblock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date,
          startTime: minutesToTimeLabel(startMinutes),
          endTime: minutesToTimeLabel(endMinutes),
        }),
      });
    }, `Reopened ${minutesToTimeLabel(startMinutes)}–${minutesToTimeLabel(endMinutes)}`);
  }

  function removeBlock(block: Block) {
    void withUndo(async () => {
      await adminFetchJson(`${blocksBase}/${block.id}`, { method: 'DELETE' });
    }, `Removed ${minutesToTimeLabel(block.startMinutes)}–${minutesToTimeLabel(block.endMinutes)}`);
  }

  async function undoLast() {
    if (!undo) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ blocks: Block[] }>(`${blocksBase}/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date,
          blocks: undo.snapshot.map((b) => ({
            startMinutes: b.startMinutes,
            endMinutes: b.endMinutes,
            reason: b.reason,
          })),
        }),
      });
      setBlocks(result.blocks);
      setUndo(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startEditingReason(block: Block) {
    setEditingReasonId(block.id);
    setReasonDraft(block.reason ?? '');
  }

  async function saveReason(id: string) {
    setBusy(true);
    setError(null);
    try {
      await adminFetchJson(`${blocksBase}/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reasonDraft.trim() || null }),
      });
      setEditingReasonId(null);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitClosed() {
    setSavingException(true);
    setError(null);
    try {
      await adminFetchJson(overridesBase, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, isClosed: true, note: exceptionNote || undefined }),
      });
      setExceptionForm(null);
      setExceptionNote('');
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingException(false);
    }
  }

  async function submitSpecialHours(event: React.FormEvent) {
    event.preventDefault();
    if (specialStart >= specialEnd) {
      setError('End time must be after the start time');
      return;
    }
    setSavingException(true);
    setError(null);
    try {
      await adminFetchJson(overridesBase, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date,
          isClosed: false,
          startTime: specialStart,
          endTime: specialEnd,
          note: exceptionNote || undefined,
        }),
      });
      setExceptionForm(null);
      setExceptionNote('');
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingException(false);
    }
  }

  async function revertToUsualHours() {
    if (!currentOverride) return;
    setSavingException(true);
    setError(null);
    try {
      await adminFetchJson(`${overridesBase}/${currentOverride.id}`, { method: 'DELETE' });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingException(false);
    }
  }

  return (
    <div className="card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div className="admin-card-title" style={{ margin: 0 }}>
          {DateTime.fromISO(date).toFormat('cccc, d LLLL')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="btn-secondary" onClick={() => shiftDate(-1)} aria-label="Previous day">
            ‹
          </button>
          {date !== todayIso() && (
            <button type="button" className="btn-link" onClick={() => setDate(todayIso())}>
              Today
            </button>
          )}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button type="button" className="btn-secondary" onClick={() => shiftDate(1)} aria-label="Next day">
            ›
          </button>
        </div>
      </div>

      <DayStrip date={date} overrides={overrides} onSelect={setDate} />

      {isPast && (
        <p style={{ fontSize: '0.8rem', color: 'var(--faint)', margin: '-8px 0 16px' }}>
          This date has already passed.
        </p>
      )}

      {!loading && (
        <div className="exception-status">
          {currentOverride ? (
            <>
              <span>
                {currentOverride.isClosed
                  ? 'Closed all day'
                  : `Special hours: ${currentOverride.startTime} – ${currentOverride.endTime} only`}
                {currentOverride.note ? ` · ${currentOverride.note}` : ''}
              </span>
              <button type="button" className="btn-link" disabled={savingException} onClick={revertToUsualHours}>
                Revert to usual hours
              </button>
            </>
          ) : exceptionForm === null ? (
            <>
              <span style={{ color: 'var(--muted)' }}>
                Usual hours:{' '}
                {usualHours.length === 0
                  ? 'closed'
                  : usualHours.map((r) => `${r.startTime}–${r.endTime}`).join(', ')}
              </span>
              <div style={{ display: 'flex', gap: 14 }}>
                <button type="button" className="btn-link" onClick={() => setExceptionForm('closed')}>
                  Close this day
                </button>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setExceptionForm('special')}
                >
                  Set special hours
                </button>
              </div>
            </>
          ) : exceptionForm === 'closed' ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, width: '100%' }}>
              <input
                type="text"
                placeholder="Note (optional) — e.g. Public holiday"
                value={exceptionNote}
                onChange={(e) => setExceptionNote(e.target.value)}
                style={{ flex: 1, minWidth: 180 }}
              />
              <button type="button" className="btn-primary" disabled={savingException} onClick={submitClosed}>
                {savingException ? 'Saving…' : 'Close this day'}
              </button>
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setExceptionForm(null);
                  setExceptionNote('');
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <form
              onSubmit={submitSpecialHours}
              style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, width: '100%' }}
            >
              <input
                type="time"
                value={specialStart}
                onChange={(e) => setSpecialStart(e.target.value)}
                style={{ width: 110 }}
              />
              <span style={{ color: 'var(--faint)' }}>–</span>
              <input
                type="time"
                value={specialEnd}
                onChange={(e) => setSpecialEnd(e.target.value)}
                style={{ width: 110 }}
              />
              <input
                type="text"
                placeholder="Note (optional)"
                value={exceptionNote}
                onChange={(e) => setExceptionNote(e.target.value)}
                style={{ flex: 1, minWidth: 160 }}
              />
              <button type="submit" className="btn-primary" disabled={savingException}>
                {savingException ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setExceptionForm(null);
                  setExceptionNote('');
                }}
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      )}

      {undo && (
        <div className="notice notice-success" role="status">
          <span>{undo.message}</span>
          <button
            type="button"
            className="btn-link"
            style={{ color: 'inherit', fontWeight: 600 }}
            disabled={busy}
            onClick={() => void undoLast()}
          >
            Undo
          </button>
        </div>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="status">Loading…</p>}

      {!loading && !currentOverride?.isClosed && windows.length === 0 && rules.length === 0 && (
        <p className="notice notice-muted" style={{ margin: 0 }}>
          Nothing to block — you haven&apos;t set any weekly hours yet. Set them in Weekly hours above.
        </p>
      )}

      {!loading && windows.length === 0 && rules.length > 0 && (
        <p className="notice notice-muted" style={{ margin: 0 }}>
          Closed on this date — nothing to block.
        </p>
      )}

      {!loading &&
        windows.map((window, i) => (
          <WindowGrid
            key={i}
            cells={cellsByWindow[i]!}
            busy={busy}
            onBlockRange={blockRange}
            onUnblockRange={unblockRange}
          />
        ))}

      {windows.length > 0 && (
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '12px 0 0' }}>
          Click a half-hour, or drag across several, to take it off the calendar just for this day.
          Click — or press Space or Enter on — a blocked one to open it back up.
        </p>
      )}

      {!loading && blocks.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--rule)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--faint)', marginBottom: 8 }}>
            Blocked this day
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {blocks.map((b) => (
              <div key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: '0.88rem' }}>
                    {minutesToTimeLabel(b.startMinutes)} – {minutesToTimeLabel(b.endMinutes)}
                    {b.reason ? <span style={{ color: 'var(--faint)' }}> · {b.reason}</span> : null}
                  </div>
                  <div style={{ display: 'flex', gap: 14 }}>
                    {editingReasonId !== b.id && (
                      <button type="button" className="btn-link" onClick={() => startEditingReason(b)}>
                        {b.reason ? 'Edit reason' : '+ Reason'}
                      </button>
                    )}
                    <button type="button" className="btn-link" onClick={() => removeBlock(b)}>
                      Remove
                    </button>
                  </div>
                </div>
                {editingReasonId === b.id && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="text"
                      autoFocus
                      value={reasonDraft}
                      placeholder="What is this for?"
                      onChange={(e) => setReasonDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveReason(b.id);
                        if (e.key === 'Escape') setEditingReasonId(null);
                      }}
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="btn-primary" disabled={busy} onClick={() => void saveReason(b.id)}>
                      Save
                    </button>
                    <button type="button" className="btn-link" onClick={() => setEditingReasonId(null)}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
