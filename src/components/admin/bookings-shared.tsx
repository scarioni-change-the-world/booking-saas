'use client';

import { useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';
import type { Reconsideration } from '@/lib/reconsideration';

/**
 * One definition of a booking as the dashboard sees it, and of the three
 * things a business can do to one — cancel it, resend its email, make the
 * person a client.
 *
 * Shared by the list of bookings and the Week's side panel. Two screens that
 * each carried their own copy of "cancel" would, sooner or later, disagree
 * about what cancelling does.
 */

export type SyncStatus = 'pending' | 'synced' | 'failed' | 'not_configured';
export type EmailStatus = 'pending' | 'sent' | 'failed' | 'not_configured';

export interface AnsweredQuestion {
  questionId: string;
  prompt: string;
  kind: 'text' | 'yes_no' | 'single_choice';
  answer: string;
  outcomePathType: 'meeting' | 'other' | null;
}

export interface Booking {
  id: string;
  eventTypeName: string;
  startsAt: string;
  endsAt: string;
  name: string;
  email: string;
  notes: string | null;
  status: 'confirmed' | 'cancelled';
  cancelledAt: string | null;
  cancellationReason: string | null;
  meetingUrl: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  emailStatus: EmailStatus;
  emailError: string | null;
  qualification: { outcomePathType: 'meeting' | 'other'; answers: AnsweredQuestion[] } | null;
  createdAt: string;
  /** Whether this person already has a client record, matched on their
   * email — see the bookings route for why not on client_id. */
  isClient: boolean;
  /** Set when this appointment is one of a programme — see the row marker. */
  pack: {
    size: number;
    booked: number;
    remaining: number;
    priorSessionsOwed: number | null;
  } | null;
  /** Set when this booking was made on a second attempt, after the person
   * had already been sent elsewhere. */
  reconsidered: Reconsideration | null;
}

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function formatRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return `${dayFormat.format(start)} · ${timeFormat.format(start)} – ${timeFormat.format(end)}`;
}

export function syncBadge(status: SyncStatus): { label: string; tone: 'live' | 'attention' | 'broken' } | null {
  if (status === 'failed') return { label: 'Calendar sync failed', tone: 'broken' };
  if (status === 'pending') return { label: 'Syncing…', tone: 'attention' };
  return null;
}

/** Same shape as syncBadge — both are "a side effect that must never block
 * the booking, with its outcome shown rather than hidden" (see
 * src/lib/booking-email.ts). 'not_configured' gets a badge too, quiet
 * rather than absent: with no badge at all it looks identical to a real
 * send, which is exactly the ambiguity worth avoiding while SMTP isn't
 * set up yet. */
export function emailBadge(
  status: EmailStatus,
): { label: string; tone: 'live' | 'attention' | 'broken' | 'muted' } | null {
  if (status === 'failed') return { label: 'Email failed', tone: 'broken' };
  if (status === 'pending') return { label: 'Sending email…', tone: 'attention' };
  if (status === 'not_configured') return { label: 'Email not sent — SMTP not configured', tone: 'muted' };
  return null;
}

export function toneStyle(tone: 'live' | 'attention' | 'broken' | 'muted') {
  if (tone === 'live') return { background: 'var(--status-live-tint)', color: 'var(--status-live-ink)' };
  if (tone === 'attention')
    return { background: 'var(--status-attention-tint)', color: 'var(--status-attention-ink)' };
  if (tone === 'muted') return { background: 'var(--accent-tint)', color: 'var(--faint)' };
  return { background: 'var(--status-broken-tint)', color: 'var(--status-broken)' };
}


/**
 * The three actions, with their busy state. `onDone` runs after each one
 * succeeds so the caller can reload whatever it is showing.
 *
 * Cancelling takes the reason as an argument rather than asking for it:
 * the list asks with the browser's own prompt, the Week asks inline in its
 * panel, and both end up here.
 */
export function useBookingActions(slug: string, onDone: () => Promise<void> | void) {
  const base = `/api/admin/${slug}/bookings`;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      await onDone();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function cancel(booking: Booking, reason: string) {
    return run(booking.id, async () => {
      await adminFetchJson(`${base}/${booking.id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason || undefined }),
      });
    });
  }

  function retryEmail(booking: Booking) {
    return run(booking.id, async () => {
      await adminFetchJson(`${base}/${booking.id}/retry-email`, { method: 'POST' });
    });
  }

  function addAsClient(booking: Booking) {
    return run(booking.id, async () => {
      const result = await adminFetchJson<{ inviteStatus: 'sent' | 'failed' | 'not_configured' | null }>(
        `/api/admin/${slug}/clients`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: booking.name, email: booking.email, sendInvite: true }),
        },
      );
      setNotice(
        result.inviteStatus === 'sent'
          ? `${booking.name} has their own link — it's on its way to them.`
          : `${booking.name} has their own link, but the email didn't go out${
              result.inviteStatus === 'not_configured' ? ' (email isn’t set up yet)' : ''
            }. Copy it from their row in People and send it yourself.`,
      );
    });
  }

  return { busyId, error, notice, setError, cancel, retryEmail, addAsClient };
}
