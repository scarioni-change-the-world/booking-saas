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
  date: string;
  isClosed: boolean;
  startTime: string | null;
  endTime: string | null;
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

/** The grid's own granularity. Not user-configurable in v1 — every block this
 * UI creates lands on a 30-minute boundary, same as the booking widget's own
 * slot picker, so the two always feel like the same clock. */
const CELL_MINUTES = 30;

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
 * One open window, rendered as a column of half-hour cells the caller can
 * click or drag across.
 *
 * Index arithmetic, not per-cell listeners: the container itself owns the
 * pointer, captured on pointerdown, and every move is translated to "which
 * row is this Y coordinate over" — simpler than tracking enter/leave across
 * dozens of children, and it is what makes a fast drag past a cell (the
 * pointer moves faster than pointermove fires) still select every row in
 * between rather than skipping some.
 *
 * Which cell the drag started on decides the mode for that whole gesture:
 * starting on an open cell selects a range to block; starting on an already
 * -blocked one selects a range to reopen. Either way the selection is
 * clamped so it never crosses from one kind of cell into the other — a
 * single drag never both blocks and unblocks.
 */
function WindowGrid({
  cells,
  busy,
  pendingRange,
  onSelectBlockRange,
  onUnblockRange,
}: {
  cells: Cell[];
  busy: boolean;
  /** A block-mode selection this window made that is still awaiting the
   * caller's reason-and-confirm panel — kept highlighted even though the
   * live drag that produced it has already ended. */
  pendingRange: [number, number] | null;
  onSelectBlockRange: (startMinutes: number, endMinutes: number) => void;
  onUnblockRange: (startMinutes: number, endMinutes: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
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
      onSelectBlockRange(startMinutes, endMinutes);
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

  const liveRange: [number, number] | null =
    anchor !== null && dragEnd !== null ? [Math.min(anchor, dragEnd), Math.max(anchor, dragEnd)] : null;
  const selectedRange = liveRange ?? pendingRange;
  const selectingMode = liveRange ? mode : pendingRange ? 'block' : null;

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
          selecting && selectingMode === 'block' && 'selecting',
          selecting && selectingMode === 'unblock' && 'unselecting',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div key={cell.startMinutes} className={className}>
            <span>
              {minutesToTimeLabel(cell.startMinutes)} – {minutesToTimeLabel(cell.endMinutes)}
            </span>
            {blocked && <span className="block-cell-badge">Blocked</span>}
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  slug: string;
  rules: Rule[];
  overrides: Override[];
}

/**
 * Ad hoc hour blocking — click a half-hour, or drag across several, to take
 * time off the calendar without touching the weekly hours or adding a full
 * date exception. Backed by blocked_slots (migration 0002), which the slot
 * engine already excludes bookable time from; this is the first UI that
 * writes to it.
 */
export default function BlockTimeGrid({ slug, rules, overrides }: Props) {
  const base = `/api/admin/${slug}/blocked-slots`;

  const [date, setDate] = useState(todayIso());
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A block-mode selection awaiting its reason-and-confirm step. windowIndex
  // says which WindowGrid keeps it highlighted after the live drag ends.
  const [pending, setPending] = useState<{
    windowIndex: number;
    startMinutes: number;
    endMinutes: number;
    reason: string;
  } | null>(null);

  const windows = useMemo(() => windowsForSelectedDate(date, rules, overrides), [date, rules, overrides]);
  const cellsByWindow = useMemo(() => windows.map((w) => buildCells(w, blocks)), [windows, blocks]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ blocks: Block[] }>(`${base}?date=${date}`);
      setBlocks(result.blocks);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPending(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- base is stable for the life of this component
  }, [date]);

  function shiftDate(days: number) {
    setDate(DateTime.fromISO(date).plus({ days }).toFormat('yyyy-MM-dd'));
  }

  function selectBlockRange(windowIndex: number, startMinutes: number, endMinutes: number) {
    setPending({ windowIndex, startMinutes, endMinutes, reason: '' });
  }

  async function confirmPending() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await adminFetchJson(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date,
          startTime: minutesToTimeLabel(pending.startMinutes),
          endTime: minutesToTimeLabel(pending.endMinutes),
          reason: pending.reason.trim() || undefined,
        }),
      });
      setPending(null);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unblockRange(startMinutes: number, endMinutes: number) {
    setBusy(true);
    setError(null);
    try {
      const result = await adminFetchJson<{ blocks: Block[] }>(`${base}/unblock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date,
          startTime: minutesToTimeLabel(startMinutes),
          endTime: minutesToTimeLabel(endMinutes),
        }),
      });
      setBlocks(result.blocks);
    } catch (cause) {
      setError((cause as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeBlock(id: string) {
    setBusy(true);
    setError(null);
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    try {
      await adminFetchJson(`${base}/${id}`, { method: 'DELETE' });
    } catch (cause) {
      setError((cause as Error).message);
      await load();
    } finally {
      setBusy(false);
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
          Block time
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="btn-secondary" onClick={() => shiftDate(-1)} aria-label="Previous day">
            ‹
          </button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button type="button" className="btn-secondary" onClick={() => shiftDate(1)} aria-label="Next day">
            ›
          </button>
        </div>
      </div>

      <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '-4px 0 16px', maxWidth: 560 }}>
        Click a half-hour, or drag across several, to take it off the calendar just for this day —
        an appointment, a slow morning, anything that doesn&apos;t belong in the weekly hours.
        Click a blocked one again to open it back up.
      </p>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {loading && <p className="status">Loading…</p>}

      {!loading && windows.length === 0 && (
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
            pendingRange={
              pending && pending.windowIndex === i
                ? [
                    cellsByWindow[i]!.findIndex((c) => c.startMinutes === pending.startMinutes),
                    cellsByWindow[i]!.findIndex((c) => c.endMinutes === pending.endMinutes),
                  ]
                : null
            }
            onSelectBlockRange={(start, end) => selectBlockRange(i, start, end)}
            onUnblockRange={unblockRange}
          />
        ))}

      {pending && (
        <div
          style={{
            border: '1px solid var(--accent)',
            borderRadius: 'var(--radius)',
            padding: 14,
            marginTop: 12,
          }}
        >
          <div style={{ fontSize: '0.9rem', marginBottom: 10 }}>
            Block {minutesToTimeLabel(pending.startMinutes)} – {minutesToTimeLabel(pending.endMinutes)}?
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="block-reason">What is this for? (optional, only your team sees it)</label>
            <input
              id="block-reason"
              type="text"
              autoFocus
              value={pending.reason}
              onChange={(e) => setPending({ ...pending, reason: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void confirmPending();
                }
                if (e.key === 'Escape') setPending(null);
              }}
            />
          </div>
          <div className="actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void confirmPending()}>
              {busy ? 'Blocking…' : 'Block this time'}
            </button>
            <button type="button" className="btn-link" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!loading && blocks.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--rule)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--faint)', marginBottom: 8 }}>
            Blocked this day
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {blocks.map((b) => (
              <div
                key={b.id}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
              >
                <div style={{ fontSize: '0.88rem' }}>
                  {minutesToTimeLabel(b.startMinutes)} – {minutesToTimeLabel(b.endMinutes)}
                  {b.reason ? <span style={{ color: 'var(--faint)' }}> · {b.reason}</span> : null}
                </div>
                <button type="button" className="btn-link" onClick={() => removeBlock(b.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
