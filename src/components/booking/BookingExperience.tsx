'use client';

import { useState } from 'react';
import { DateNavigator } from './DateNavigator';
import { ProgressHeader } from './ProgressHeader';
import { downloadIcs, googleCalendarUrl, type CalendarEvent } from './calendar-actions';
import { articleFor } from './journey';
import { formatMoney } from '@/lib/money';
import { LOCATION_LABELS, describeLocation } from '@/lib/service-location';
import { groupSlots } from './slots';
import type { BookingJourney } from './useBookingJourney';

/**
 * The booking journey on screen — one set of steps, whatever shell they sit
 * inside.
 *
 * This component renders; it decides nothing. Every rule about what happens
 * next lives in useBookingJourney, which is what lets a shared link and an
 * iframe on somebody's own website be the same product rather than two that
 * look alike until one of them is changed.
 */

/** How many times to show in a period before offering the rest. A morning
 * with twenty openings is a wall; the first eight are a choice. */
const SLOTS_BEFORE_MORE = 8;

export function BookingExperience({ journey }: { journey: BookingJourney }) {
  const {
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
    name,
    setName,
    notes,
    setNotes,
    submitDetails,
    confirmBooking,
    confirmed,
  } = journey;

  const [expandedPeriods, setExpandedPeriods] = useState<Record<string, boolean>>({});

  const dayFormat = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const dowFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

  const formatDay = (date: string) => dayFormat.format(new Date(`${date}T12:00:00`));

  /**
   * Render the day an instant falls on, in the viewer's timezone.
   *
   * Not the same as slicing the ISO string: that yields the UTC date, which
   * is the wrong day for any viewer whose local date has already rolled over.
   */
  const formatInstantDay = (iso: string) => dayFormat.format(new Date(iso));
  const formatTime = (iso: string) => timeFormat.format(new Date(iso));

  /** "10:00 – 10:30", using the service's own duration — never a fixed grid. */
  const formatTimeRange = (iso: string, durationMinutes: number) => {
    const start = new Date(iso);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    return `${timeFormat.format(start)} – ${timeFormat.format(end)}`;
  };

  if (phase === 'loading' && !error) {
    return (
      <p className="bk-status" role="status">
        Loading…
      </p>
    );
  }

  const activeDay = days.find((d) => d.date === selectedDate) ?? null;
  const currency = config?.currency ?? 'EUR';
  const reviewLocation = eventType
    ? describeLocation(eventType.locationKind, eventType.locationDetail)
    : null;

  return (
    <div className="bk-steps">
      {currentStep && (
        <ProgressHeader
          steps={steps}
          current={currentStep}
          canGoBack={canGoBack}
          onBack={back}
        />
      )}

      {error && (
        <p className="bk-error" role="alert">
          {error}
        </p>
      )}

      {/* ─── Service ─────────────────────────────────────────────────── */}
      {phase === 'service' && (
        <section>
          <h1 className="bk-heading">Choose a service</h1>
          {eventTypes.length === 0 ? (
            <p className="bk-empty">
              There is nothing available to book right now. Please check back shortly.
            </p>
          ) : (
            <>
              <p className="bk-lede">
                Pick the one that fits and we&apos;ll take it from there.
              </p>
              <ul className="bk-service-list">
                {eventTypes.map((type) => (
                  <li key={type.id}>
                    {/* The whole row is the target, not a radio the size of a
                        full stop. */}
                    <button
                      type="button"
                      className="bk-service-option"
                      disabled={busy}
                      onClick={() => void chooseEventType(type)}
                    >
                      <span className="bk-service-option-main">
                        <span className="bk-service-option-name">{type.name}</span>
                        {type.description && (
                          <span className="bk-service-option-note">{type.description}</span>
                        )}
                        <span className="bk-service-option-facts">
                          {/* The kind of location, not the address. At the
                              moment of choosing, "In person" is the fact that
                              decides; the street belongs on review and on the
                              confirmation, where somebody is working out how
                              to get there. */}
                          {[
                            `${type.durationMinutes} minutes`,
                            type.locationKind ? LOCATION_LABELS[type.locationKind] : null,
                            type.bookingMode === 'pack' && type.packSize
                              ? `part of ${articleFor(type.packSize)} ${
                                  type.packSize
                                }-session package`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      {/* Right-hand column, the way a menu sets a price:
                          it is the second thing anyone looks for, and in the
                          facts run it was the fifth. */}
                      {type.priceMinor !== null && (
                        <span className="bk-service-option-price">
                          {formatMoney(type.priceMinor, currency)}
                          {type.bookingMode === 'pack' && (
                            <span className="bk-service-option-per">per session</span>
                          )}
                        </span>
                      )}
                      <span className="bk-service-option-go" aria-hidden="true">
                        →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* ─── A few questions: the address first ──────────────────────── */}
      {phase === 'email' && (
        <section>
          <h1 className="bk-heading">Before we find a time</h1>
          <p className="bk-lede">
            A few short questions will help {config?.name ?? 'us'} understand what you need.
            First, where can we reach you?
          </p>

          <form onSubmit={submitEmail} className="bk-form">
            <div className="field">
              <label htmlFor="prospect-email">Email</label>
              <input
                id="prospect-email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="bk-hint">
                So {config?.name ?? 'we'} can reply either way, whatever comes next.
              </p>
            </div>

            <button type="submit" className="btn-primary btn-full" disabled={busy}>
              {busy ? 'Continuing…' : 'Continue'}
            </button>
          </form>
        </section>
      )}

      {/* ─── A few questions: the questions ──────────────────────────── */}
      {phase === 'questions' && (
        <section>
          <h1 className="bk-heading">Before we find a time</h1>
          <p className="bk-lede">
            A few short questions will help {config?.name ?? 'us'} understand what you need.
          </p>

          <form onSubmit={submitAnswers} className="bk-form">
            {questions.map((question, i) => {
              const legendId = `q-${question.id}`;
              return (
                <fieldset className="bk-question" key={question.id}>
                  <legend id={legendId}>
                    <span className="bk-question-num">{i + 1}</span>
                    <span>
                      {question.prompt}
                      {question.required && <span className="bk-required"> *</span>}
                    </span>
                  </legend>

                  {question.kind === 'text' ? (
                    <textarea
                      aria-labelledby={legendId}
                      value={answers[question.id] ?? ''}
                      required={question.required}
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))
                      }
                    />
                  ) : (
                    <div className="bk-options">
                      {question.options.map((option) => (
                        <label
                          key={option}
                          className={`bk-option${
                            answers[question.id] === option ? ' is-selected' : ''
                          }`}
                        >
                          <input
                            type="radio"
                            name={question.id}
                            value={option}
                            required={question.required}
                            checked={answers[question.id] === option}
                            onChange={() =>
                              setAnswers((prev) => ({ ...prev, [question.id]: option }))
                            }
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              );
            })}

            <button type="submit" className="btn-primary btn-full" disabled={busy}>
              {busy ? 'Just a moment…' : 'Continue'}
            </button>
            <p className="bk-count" aria-live="polite">
              {answeredCount} of {questions.length} answered
            </p>
          </form>
        </section>
      )}

      {/* ─── A better next step than a meeting ───────────────────────── */}
      {phase === 'other' && otherPath && (
        <section>
          <h1 className="bk-heading">Thank you for sharing that.</h1>
          <p className="bk-lede">
            At this point, this may be more helpful than a meeting.
          </p>

          <div className="bk-resource">
            <p className="bk-resource-body">{otherPath.message}</p>
            {otherPath.url && (
              <a className="btn-primary btn-full bk-resource-link" href={otherPath.url}>
                {otherPath.label ?? 'Open it'}
              </a>
            )}
          </div>

          {/* A way back, not an appeal. Nothing here explains how the answers
              were read — that is the business's reasoning, not the client's
              to argue with. */}
          <p className="bk-aside">
            <button type="button" className="bk-textlink" onClick={() => editStep('questions')}>
              Review my answers
            </button>
          </p>
        </section>
      )}

      {/* ─── Time ───────────────────────────────────────────────────── */}
      {phase === 'time' && eventType && (
        <section>
          <h1 className="bk-heading">Choose a time</h1>

          {busy && (
            <p className="bk-status" role="status">
              Finding available times…
            </p>
          )}

          {!busy && days.length === 0 && (
            <p className="bk-empty">
              There are no times available in the next few weeks. Please check back, or get in
              touch with {config?.name ?? 'us'} directly.
            </p>
          )}

          {days.length > 0 && (
            <>
              <DateNavigator
                days={days}
                selectedDate={selectedDate}
                onSelect={setSelectedDate}
                dowFormat={dowFormat}
              />

              {activeDay && (
                <div className="bk-times">
                  <h2 className="bk-day">{formatDay(activeDay.date)}</h2>

                  {groupSlots(activeDay.slots).map((group) => {
                    const key = `${activeDay.date}:${group.period}`;
                    const expanded = expandedPeriods[key] ?? false;
                    const shown = expanded
                      ? group.slots
                      : group.slots.slice(0, SLOTS_BEFORE_MORE);
                    const hidden = group.slots.length - shown.length;

                    return (
                      <div className="bk-period" key={group.period}>
                        <h3 className="bk-period-label">{group.label}</h3>
                        <div className="bk-slots">
                          {shown.map((iso) => (
                            <button
                              key={iso}
                              type="button"
                              className={`bk-slot${slot === iso ? ' is-selected' : ''}`}
                              onClick={() => chooseSlot(iso)}
                            >
                              {formatTimeRange(iso, eventType.durationMinutes)}
                            </button>
                          ))}
                        </div>
                        {hidden > 0 && (
                          <button
                            type="button"
                            className="bk-textlink bk-more"
                            onClick={() =>
                              setExpandedPeriods((prev) => ({ ...prev, [key]: true }))
                            }
                          >
                            Show {hidden} more
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <p className="bk-zone">Times are shown in your timezone: {viewerZone}.</p>
        </section>
      )}

      {/* ─── Your details ───────────────────────────────────────────── */}
      {phase === 'details' && eventType && slot && (
        <section>
          <h1 className="bk-heading">Your details</h1>
          <p className="bk-lede">
            {eventType.name} · {formatInstantDay(slot)} at{' '}
            {formatTimeRange(slot, eventType.durationMinutes)}
          </p>

          <form onSubmit={submitDetails} className="bk-form">
            <div className="field">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="bk-hint">Your confirmation and any changes go here.</p>
            </div>

            <div className="field">
              <label htmlFor="notes">Anything {config?.name ?? 'we'} should know?</label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <p className="bk-hint">Optional.</p>
            </div>

            <p className="bk-privacy">
              Your details are used to arrange and manage this booking, and are shared with{' '}
              {config?.name ?? 'the business you are booking with'}. Nothing else.
            </p>

            <button type="submit" className="btn-primary btn-full">
              Review booking
            </button>
          </form>
        </section>
      )}

      {/* ─── Review ─────────────────────────────────────────────────── */}
      {phase === 'review' && eventType && slot && (
        <section>
          <h1 className="bk-heading">Check this over</h1>
          <p className="bk-lede">Nothing is booked until you confirm.</p>

          <dl className="bk-review">
            <div className="bk-review-row">
              <dt>Service</dt>
              <dd>
                {eventType.name}
                {eventTypes.length > 1 && (
                  <button
                    type="button"
                    className="bk-textlink bk-edit"
                    onClick={() => editStep('service')}
                  >
                    Change
                  </button>
                )}
              </dd>
            </div>
            <div className="bk-review-row">
              <dt>With</dt>
              <dd>{config?.name}</dd>
            </div>
            <div className="bk-review-row">
              <dt>When</dt>
              <dd>
                {formatInstantDay(slot)}, {formatTimeRange(slot, eventType.durationMinutes)}
                <button
                  type="button"
                  className="bk-textlink bk-edit"
                  onClick={() => editStep('time')}
                >
                  Change
                </button>
                <span className="bk-review-sub">{viewerZone}</span>
              </dd>
            </div>
            <div className="bk-review-row">
              <dt>Length</dt>
              <dd>{eventType.durationMinutes} minutes</dd>
            </div>
            {reviewLocation && (
              <div className="bk-review-row">
                <dt>Where</dt>
                <dd>{reviewLocation}</dd>
              </div>
            )}
            {/* Shown only when there is one. Nobody should have to wonder,
                at the moment of confirming, whether a blank line means free
                or means nobody said. */}
            {eventType.priceMinor !== null && (
              <div className="bk-review-row">
                <dt>Price</dt>
                <dd>
                  {formatMoney(eventType.priceMinor, currency)}
                  {eventType.bookingMode === 'pack' && (
                    <span className="bk-review-sub">per session</span>
                  )}
                </dd>
              </div>
            )}
            <div className="bk-review-row">
              <dt>You</dt>
              <dd>
                {name}
                <button
                  type="button"
                  className="bk-textlink bk-edit"
                  onClick={() => editStep('details')}
                >
                  Change
                </button>
                <span className="bk-review-sub">{email}</span>
              </dd>
            </div>
            {notes.trim() !== '' && (
              <div className="bk-review-row">
                <dt>Your note</dt>
                <dd className="bk-review-note">{notes}</dd>
              </div>
            )}
          </dl>

          <button
            type="button"
            className="btn-primary btn-full"
            disabled={busy}
            onClick={() => void confirmBooking()}
          >
            {busy ? 'Booking…' : 'Confirm booking'}
          </button>
        </section>
      )}

      {/* ─── Confirmed ──────────────────────────────────────────────── */}
      {phase === 'confirmed' && confirmed && eventType && (
        <Confirmation
          confirmed={confirmed}
          serviceName={eventType.name}
          durationMinutes={eventType.durationMinutes}
          location={reviewLocation}
          locationDetail={eventType.locationDetail}
          businessName={config?.name ?? ''}
          email={email}
          viewerZone={viewerZone}
          formatInstantDay={formatInstantDay}
          formatTimeRange={formatTimeRange}
        />
      )}
    </div>
  );
}

/**
 * The last screen, and the one most likely to be the only record a client
 * keeps. Calm, short, and every fact they need to turn up.
 */
function Confirmation({
  confirmed,
  serviceName,
  durationMinutes,
  location,
  locationDetail,
  businessName,
  email,
  viewerZone,
  formatInstantDay,
  formatTimeRange,
}: {
  confirmed: {
    startsAt: string;
    manageToken: string;
    meetingUrl: string | null;
    confirmationEmailSent: boolean;
  };
  serviceName: string;
  durationMinutes: number;
  location: string | null;
  locationDetail: string | null;
  businessName: string;
  email: string;
  viewerZone: string;
  formatInstantDay: (iso: string) => string;
  formatTimeRange: (iso: string, durationMinutes: number) => string;
}) {
  const event: CalendarEvent = {
    title: `${serviceName} with ${businessName}`,
    startsAt: confirmed.startsAt,
    durationMinutes,
    details: confirmed.meetingUrl ? `Join: ${confirmed.meetingUrl}` : undefined,
    /* A video link if there is one, because that is what somebody taps from
       a calendar reminder. Otherwise the address the business wrote — an
       in-person appointment whose calendar entry has no address is the one
       people arrive late to. */
    location: confirmed.meetingUrl ?? locationDetail ?? location ?? undefined,
    uid: confirmed.manageToken,
  };

  return (
    <section>
      <h1 className="bk-heading">You&apos;re booked.</h1>

      <div className="bk-confirmed">
        <p className="bk-confirmed-when">{formatInstantDay(confirmed.startsAt)}</p>
        <p className="bk-confirmed-time">
          {formatTimeRange(confirmed.startsAt, durationMinutes)}
        </p>
        <p className="bk-confirmed-what">
          {serviceName} with {businessName}
        </p>
        {location && !confirmed.meetingUrl && (
          <p className="bk-confirmed-where">{location}</p>
        )}
        <p className="bk-confirmed-zone">{viewerZone}</p>
      </div>

      {confirmed.meetingUrl && (
        <a className="bk-join" href={confirmed.meetingUrl}>
          Join the video call
        </a>
      )}

      <div className="bk-add">
        <p className="bk-add-label">Add it to your calendar</p>
        <div className="bk-add-actions">
          <a
            className="bk-textlink"
            href={googleCalendarUrl(event)}
            target="_blank"
            rel="noreferrer"
          >
            Google Calendar
          </a>
          <button type="button" className="bk-textlink" onClick={() => downloadIcs(event)}>
            Apple, Outlook or other
          </button>
        </div>
      </div>

      {/* Which of these two shows is decided by whether an email really went
          out, not by whether one was meant to. Promising a confirmation that
          never left the building is the worst version of this screen: it is
          the person who believes it who arrives at no appointment, because
          they trusted the email instead of noting the time. */}
      {confirmed.confirmationEmailSent ? (
        <p className="bk-after">
          We&apos;ve sent a confirmation to <strong>{email}</strong> with everything you
          need{confirmed.meetingUrl ? ', including the video call link' : ''}. Nothing
          arrived? Check your spam folder. You can{' '}
          <a href={`/manage/${confirmed.manageToken}`}>reschedule or cancel</a> here — worth
          keeping this link.
        </p>
      ) : (
        /* No email is coming, so this page is the only record. Said without
           alarm — a visitor cannot act on a mail server being down, and
           telling them it is would only make a booking that worked feel
           broken. What they can act on is keeping the link. */
        <p className="bk-after">
          Your booking is confirmed. <strong>Save this link</strong> — it&apos;s how
          you&apos;ll find, change or cancel it:{' '}
          <a href={`/manage/${confirmed.manageToken}`}>manage your booking</a>.
        </p>
      )}
    </section>
  );
}
