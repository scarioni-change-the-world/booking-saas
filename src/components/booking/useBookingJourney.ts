'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Phase, StepId } from './journey';
import { applicableSteps, previousStep, stepIdFor } from './journey';
import type { DaySlots, PublicConfig, PublicEventType, PublicQuestion } from '../types';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { TEST_HEADER, type TestMessage } from '@/lib/test-run';

/**
 * What a test run adds to every request: that it is one, and who is
 * running it. The server honours the first only with the second — see
 * test-run-server.ts — so the calendar's gate cannot be skipped by adding
 * a flag to the address.
 */
async function testHeaders(): Promise<Record<string, string>> {
  const { data } = await supabaseBrowser().auth.getSession();
  const token = data.session?.access_token;
  return { [TEST_HEADER]: '1', ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

/**
 * The booking journey — all of it, and none of its appearance.
 *
 * This is what makes one booking experience serve both a shared link and an
 * iframe on somebody's own site. Every rule that decides what happens next
 * lives here; the two shells decide only how it looks. The alternative —
 * a standalone page and an embedded page, each with their own copy — is two
 * products that drift apart, and the half that drifts is always the one
 * nobody is looking at.
 *
 * Everything below the state declarations is moved from the component it
 * replaces, deliberately unchanged: the qualification gate, the per-service
 * questions, the availability load, the 409-means-the-slot-went recovery.
 * The one addition is a review step between details and the booking call,
 * and the back navigation that makes moving around the journey safe.
 */

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, { headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? 'Request failed');
  return body as T;
}

async function postJson<T>(url: string, payload: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? 'Request failed');
  return body as T;
}

export interface Confirmed {
  startsAt: string;
  manageToken: string;
  meetingUrl: string | null;
  confirmationEmailSent: boolean;
}

export interface OtherPath {
  message: string;
  url: string | null;
  label: string | null;
}

export function useBookingJourney(slug: string, options: { test?: boolean } = {}) {
  const test = options.test === true;
  const api = useMemo(
    () => ({
      get: async <T,>(url: string) => getJson<T>(url, test ? await testHeaders() : {}),
      post: async <T,>(url: string, payload: unknown) => postJson<T>(url, payload, test ? await testHeaders() : {}),
    }),
    [test],
  );
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [responseId, setResponseId] = useState<string | null>(null);
  const [otherPath, setOtherPath] = useState<OtherPath | null>(null);

  const [eventTypes, setEventTypes] = useState<PublicEventType[]>([]);
  const [eventType, setEventType] = useState<PublicEventType | null>(null);
  const [days, setDays] = useState<DaySlots[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  /* A programme's appointments, in the order the client picked them. A
     single booking keeps using `slot` — one field that is sometimes a list
     would make every reader check which it is today. */
  const [packSlots, setPackSlots] = useState<string[]>([]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [confirmedPack, setConfirmedPack] = useState<Confirmed[]>([]);
  /** Where the buyer of a programme goes to spend what they are still
   *  owed. Null for a single booking, which has no balance. */
  const [programmeLink, setProgrammeLink] = useState<string | null>(null);

  const base = `/api/t/${encodeURIComponent(slug)}`;

  /* A test run tells the Flow beside it where it has got to, so the route
     lights up as it is walked. Only to this app's own origin: the page is
     framed by nothing else in a test run, and a message for "any origin"
     would say where somebody is in a booking to whoever asked. */
  useEffect(() => {
    if (!test || typeof window === 'undefined' || window.parent === window) return;
    const message: TestMessage = { type: 'intro:test', phase, eventTypeId: eventType?.id ?? null };
    window.parent.postMessage(message, window.location.origin);
  }, [test, phase, eventType]);

  /** The client's own timezone, used only for display. */
  const viewerZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [cfg, types] = await Promise.all([
          api.get<PublicConfig>(`${base}/config`),
          api.get<{ eventTypes: PublicEventType[] }>(`${base}/event-types?audience=prospect`),
        ]);
        if (cancelled) return;

        setConfig(cfg);
        setEventTypes(types.eventTypes);
        // Which service is being booked decides which questions apply
        // (migration 0016), so that has to come first — see chooseEventType.
        setPhase('service');
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [base, api]);

  /**
   * A service has been picked — explicitly, via the one-choice auto-skip
   * below, or by changing it from the review step. Called every time,
   * deliberately: each service can have its own questions (migration 0016),
   * so switching services means re-checking what *this* one asks, not
   * assuming the last service's gate still applies. Answers already given
   * for a still-shared question carry over rather than being asked twice,
   * because `answers` is not cleared on a switch.
   */
  const chooseEventType = useCallback(
    async (type: PublicEventType) => {
      setEventType(type);
      setBusy(true);
      setError(null);
      try {
        const q = await api.get<{ questions: PublicQuestion[] }>(
          `${base}/questions?eventTypeId=${encodeURIComponent(type.id)}`,
        );
        setQuestions(q.questions);
        // Somebody who already answered keeps their place rather than being
        // sent back through the same questions by picking a service again.
        setPhase(q.questions.length > 0 ? (responseId ? 'questions' : 'email') : 'time');
      } catch (cause) {
        setError((cause as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [base, responseId, api],
  );

  // Auto-skip the service picker when there is only one choice (brief 2.3).
  useEffect(() => {
    if (phase === 'service' && eventTypes.length === 1) {
      void chooseEventType(eventTypes[0]!);
    }
  }, [phase, eventTypes, chooseEventType]);

  const loadAvailability = useCallback(
    async (chosen: PublicEventType) => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({ eventTypeId: chosen.id, audience: 'prospect' });
        if (responseId) params.set('responseId', responseId);
        const result = await api.get<{ days: DaySlots[] }>(
          `${base}/availability?${params.toString()}`,
        );
        setDays(result.days);
        // Land on the first day that actually has something to book, rather
        // than the calendar's literal first day, which is usually empty.
        setSelectedDate(result.days.find((d) => d.slots.length > 0)?.date ?? null);
      } catch (cause) {
        setError((cause as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [base, responseId, api],
  );

  useEffect(() => {
    if (phase === 'time' && eventType) void loadAvailability(eventType);
  }, [phase, eventType, loadAvailability]);

  /**
   * The first thing asked, ahead of the questions themselves — see
   * .../qualify/start. Nothing about the answers is known yet; this only
   * fixes who the response belongs to, so somebody who leaves partway
   * through still shows up in the business's own numbers instead of
   * vanishing without a trace.
   */
  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!eventType) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ responseId: string }>(`${base}/qualify/start`, {
        email,
        eventTypeId: eventType.id,
      });
      setResponseId(result.responseId);
      setPhase('questions');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswers(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{
        outcomePathType: 'meeting' | 'other';
        responseId: string;
        message?: string;
        redirectUrl?: string | null;
        redirectLabel?: string | null;
      }>(`${base}/qualify`, { responseId, answers });

      if (result.outcomePathType === 'other') {
        setOtherPath({
          message: result.message ?? config?.otherPath.message ?? '',
          url: result.redirectUrl ?? null,
          label: result.redirectLabel ?? null,
        });
        setPhase('other');
        return;
      }

      // The service was already chosen before the gate ran — no need to ask
      // again, straight to the calendar for it.
      setPhase('time');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Details are checked by the browser, then held for review — nothing is
   * booked until the client has seen the whole thing on one screen. */
  function submitDetails(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPhase('review');
  }

  async function confirmBooking() {
    if (!eventType) return;
    if (isPack ? packSlots.length !== slotsNeeded : !slot) return;

    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{
        booking: Confirmed;
        bookings: Confirmed[];
        programmeLink: string | null;
      }>(
        `${base}/bookings`,
        {
          eventTypeId: eventType.id,
          // One or the other, never both — the route reads which was sent to
          // decide what is being booked.
          ...(isPack ? { slots: packSlots } : { startsAt: slot }),
          name,
          email,
          notes,
          responseId,
        },
      );
      setConfirmed(result.booking);
      setConfirmedPack(result.bookings ?? [result.booking]);
      setProgrammeLink(result.programmeLink ?? null);
      setPhase('confirmed');
    } catch (cause) {
      setError((cause as Error).message);
      /* A 409 means a time went while the form was open. Back to the
         calendar with a clean slate rather than a stale grid — and for a
         programme that means clearing the whole set, because the server
         books all of them or none, so a partial selection would be a lie
         about what is still held. */
      const message = (cause as Error).message.toLowerCase();
      if (message.includes('available') || message.includes('just taken')) {
        setSlot(null);
        setPackSlots([]);
        setPhase('time');
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Pick a time — or, for a programme, add one to the set.
   *
   * A second press on the same time removes it rather than doing nothing.
   * Choosing ten dates means occasionally choosing the wrong one, and the
   * undo has to be in the same place as the action.
   */
  function chooseSlot(iso: string) {
    if (!isPack) {
      setSlot(iso);
      setPhase('details');
      return;
    }

    setError(null);
    setPackSlots((current) => {
      if (current.includes(iso)) return current.filter((existing) => existing !== iso);
      if (current.length >= slotsNeeded) return current;
      return [...current, iso].sort();
    });
  }

  /** Done choosing a programme's dates — only once all of them are chosen. */
  function confirmSlots() {
    if (packSlots.length !== slotsNeeded) return;
    setPhase('details');
  }

  /** How many appointments this service is booked in — 1 unless it is a pack. */
  const slotsNeeded =
    eventType?.bookingMode === 'pack' && eventType.packSize ? eventType.packSize : 1;
  const isPack = slotsNeeded > 1;

  const steps = useMemo(
    () =>
      applicableSteps({
        serviceChoice: eventTypes.length > 1,
        questions: questions.length > 0,
      }),
    [eventTypes.length, questions.length],
  );

  const currentStep: StepId | null = stepIdFor(phase);

  /**
   * Back, without losing anything.
   *
   * Every answer, the name, the email, the notes and the chosen time stay in
   * state — going back is navigation, not a reset. The one thing cleared is
   * the chosen slot when returning to the calendar, because a highlighted
   * time that is no longer the one being booked is worse than none.
   */
  const back = useCallback(() => {
    if (!currentStep) return;
    const target = previousStep(steps, currentStep);
    if (!target) return;

    setError(null);
    switch (target) {
      case 'service':
        setPhase('service');
        break;
      case 'questions':
        // Straight to the questions: the address has already been given, and
        // asking for it twice reads as the form having forgotten.
        setPhase(responseId ? 'questions' : 'email');
        break;
      case 'time':
        // The chosen times stay for a programme: going back to adjust one of
        // ten must not throw away the other nine.
        if (!isPack) setSlot(null);
        setPhase('time');
        break;
      case 'details':
        setPhase('details');
        break;
      default:
        break;
    }
  }, [currentStep, steps, responseId]);

  /** Jump straight to a step from the review screen. */
  const editStep = useCallback(
    (target: StepId) => {
      setError(null);
      if (target === 'time' && !isPack) setSlot(null);
      setPhase(target === 'questions' ? 'questions' : (target as Phase));
    },
    [isPack],
  );

  const answeredCount = questions.filter((q) => (answers[q.id] ?? '').trim() !== '').length;
  const canGoBack = currentStep !== null && previousStep(steps, currentStep) !== null;

  return {
    test,
    phase,
    steps,
    currentStep,
    canGoBack,
    back,
    editStep,

    error,
    busy,
    config,
    viewerZone,

    eventTypes,
    eventType,
    chooseEventType,

    questions,
    answers,
    setAnswers,
    answeredCount,
    email,
    setEmail,
    submitEmail,
    submitAnswers,
    otherPath,

    days,
    selectedDate,
    setSelectedDate,
    slot,
    chooseSlot,
    packSlots,
    slotsNeeded,
    isPack,
    confirmSlots,

    name,
    setName,
    notes,
    setNotes,
    submitDetails,
    confirmBooking,
    confirmed,
    confirmedPack,
    programmeLink,
  };
}

export type BookingJourney = ReturnType<typeof useBookingJourney>;
