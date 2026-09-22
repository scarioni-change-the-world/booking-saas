'use client';

import { useState } from 'react';
import { DateNavigator } from './DateNavigator';
import { ProgressHeader } from './ProgressHeader';
import {
  downloadCalendar,
  downloadIcs,
  googleCalendarUrl,
  type CalendarEvent,
} from './calendar-actions';
import { articleFor } from './journey';
import { formatMoney } from '@/lib/money';
import { LOCATION_LABELS, describeLocation } from '@/lib/service-location';
import { mapUrl, preferredMapService } from '@/lib/maps';
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
  /* The times being booked, whichever way this service is sold — so the
     steps after the calendar do not each branch on it. */
  const chosenSlots = isPack ? packSlots : slot ? [slot] : [];
  const firstSlot = chosenSlots[0] ?? null;
  const reviewLocation = eventType
    ? describeLocation(eventType.locationKind, eventType.locationDetail)
    : null;
  const reviewDirections =
    eventType?.locationKind === 'in_person' && eventType.locationDetail
      ? mapUrl(
          eventType.locationDetail,
          typeof navigator === 'undefined'
            ? 'google'
            : preferredMapService(navigator.userAgent),
        )
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

          {/* A business that never wrote an alternative message used to get
              an empty grey card here, under a sentence — "this may be more
              helpful than a meeting" — whose "this" pointed at nothing. Both
              halves are conditional now: the lede only introduces something
              when there is something to introduce, and the card only exists
              when it has content. The fallback says plainly what happened
              rather than promising a follow-up nobody committed to. */}
          {otherPath.message.trim() === '' && !otherPath.url ? (
            <p className="bk-lede">
              From your answers, {config?.name ?? 'they'} don&apos;t think a meeting is
              the right next step just now.
            </p>
          ) : (
            <>
              <p className="bk-lede">
                At this point, this may be more helpful than a meeting.
              </p>

              <div className="bk-resource">
                {otherPath.message.trim() !== '' && (
                  <p className="bk-resource-body">{otherPath.message}</p>
                )}
                {otherPath.url && (
                  <a className="btn-primary btn-full bk-resource-link" href={otherPath.url}>
                    {otherPath.label ?? 'Open it'}
                  </a>
                )}
              </div>
            </>
          )}

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
          <h1 className="bk-heading">
            {isPack ? `Choose your ${slotsNeeded} times` : 'Choose a time'}
          </h1>
          {isPack && (
            <p className="bk-lede">
              Pick every appointment now and they are all booked together. You can
              change any one of them afterwards without affecting the rest.
            </p>
          )}

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
                          {shown.map((iso) => {
                            const picked = isPack
                              ? packSlots.includes(iso)
                              : slot === iso;
                            /* Full, and this is not one of the chosen — so
                               pressing it would silently do nothing. Said
                               with a disabled state instead. */
                            const full =
                              isPack && !picked && packSlots.length >= slotsNeeded;

                            return (
                              <button
                                key={iso}
                                type="button"
                                className={`bk-slot${picked ? ' is-selected' : ''}`}
                                disabled={full}
                                aria-pressed={isPack ? picked : undefined}
                                onClick={() => chooseSlot(iso)}
                              >
                                {formatTimeRange(iso, eventType.durationMinutes)}
                              </button>
                            );
                          })}
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

          {isPack && (
            /* Sticky at the foot of the panel: choosing ten dates means
               scrolling, and a count that scrolls away stops being a count. */
            <div className="bk-pack-bar">
              <div>
                <p className="bk-pack-count" aria-live="polite">
                  {packSlots.length} of {slotsNeeded} chosen
                </p>
                {packSlots.length > 0 && (
                  <ol className="bk-pack-list">
                    {packSlots.map((iso) => (
                      <li key={iso}>
                        <span>{formatInstantDay(iso)}, {formatTime(iso)}</span>
                        <button
                          type="button"
                          className="bk-pack-remove"
                          onClick={() => chooseSlot(iso)}
                        >
                          Remove
                          <span className="sr-only">
                            {' '}
                            {formatInstantDay(iso)} at {formatTime(iso)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <button
                type="button"
                className="btn-primary btn-full"
                disabled={packSlots.length !== slotsNeeded}
                onClick={confirmSlots}
              >
                {packSlots.length === slotsNeeded
                  ? 'Continue'
                  : `Choose ${slotsNeeded - packSlots.length} more`}
              </button>
            </div>
          )}
        </section>
      )}

      {/* ─── Your details ───────────────────────────────────────────── */}
      {phase === 'details' && eventType && firstSlot && (
        <section>
          <h1 className="bk-heading">Your details</h1>
          <p className="bk-lede">
            {eventType.name} ·{' '}
            {isPack
              ? `${chosenSlots.length} appointments, starting ${formatInstantDay(firstSlot)}`
              : `${formatInstantDay(firstSlot)} at ${formatTimeRange(
                  firstSlot,
                  eventType.durationMinutes,
                )}`}
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
      {phase === 'review' && eventType && firstSlot && (
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
              <dt>{isPack ? 'Appointments' : 'When'}</dt>
              <dd>
                {isPack ? (
                  /* Every one of them, numbered. This is the last screen
                     before ten commitments are made, and "10 appointments"
                     is not something anybody can check. */
                  <ol className="bk-review-dates">
                    {chosenSlots.map((iso) => (
                      <li key={iso}>
                        {formatInstantDay(iso)},{' '}
                        {formatTimeRange(iso, eventType.durationMinutes)}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <>
                    {formatInstantDay(firstSlot)},{' '}
                    {formatTimeRange(firstSlot, eventType.durationMinutes)}
                  </>
                )}
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
              <dd>
                {eventType.durationMinutes} minutes
                {isPack && <span className="bk-review-sub">each</span>}
              </dd>
            </div>
            {reviewLocation && (
              <div className="bk-review-row">
                <dt>Where</dt>
                <dd>
                  {reviewDirections ? (
                    <a
                      className="bk-map-link"
                      href={reviewDirections}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {reviewLocation}
                    </a>
                  ) : (
                    reviewLocation
                  )}
                </dd>
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
                  {isPack && (
                    /* Both numbers, because neither alone is the answer: per
                       session is what was advertised, and the total is what
                       somebody is agreeing to. */
                    <span className="bk-review-sub">
                      per session ·{' '}
                      {formatMoney(eventType.priceMinor * chosenSlots.length, currency)} in
                      total
                    </span>
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
          pack={confirmedPack}
          packSize={isPack ? slotsNeeded : 1}
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
  pack,
  packSize,
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
  pack: Array<{
    startsAt: string;
    manageToken: string;
    meetingUrl: string | null;
    confirmationEmailSent: boolean;
  }>;
  packSize: number;
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
  /* Read at render time rather than in a state hook: the value is only ever
     used to choose a URL, and reading navigator during render is safe here
     because this screen only exists after a click. The guard is for the
     server pass, where there is no navigator at all. */
  const directions =
    locationDetail && !confirmed.meetingUrl
      ? mapUrl(
          locationDetail,
          typeof navigator === 'undefined'
            ? 'google'
            : preferredMapService(navigator.userAgent),
        )
      : null;

  const calendarEventFor = (booking: {
    startsAt: string;
    manageToken: string;
    meetingUrl: string | null;
  }): CalendarEvent => ({
    title: `${serviceName} with ${businessName}`,
    startsAt: booking.startsAt,
    durationMinutes,
    details: booking.meetingUrl ? `Join: ${booking.meetingUrl}` : undefined,
    location: booking.meetingUrl ?? locationDetail ?? location ?? undefined,
    uid: booking.manageToken,
  });

  const packEvents = pack.map(calendarEventFor);

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
      <h1 className="bk-heading">
        {packSize > 1 ? "You're all booked in." : "You're booked."}
      </h1>

      {packSize > 1 && (
        <p className="bk-lede">
          All {pack.length} appointments are held. Each one can be changed or
          cancelled on its own.
        </p>
      )}

      <div className="bk-confirmed">
        <p className="bk-confirmed-when">{formatInstantDay(confirmed.startsAt)}</p>
        <p className="bk-confirmed-time">
          {formatTimeRange(confirmed.startsAt, durationMinutes)}
        </p>
        <p className="bk-confirmed-what">
          {serviceName} with {businessName}
          {packSize > 1 && <span className="bk-confirmed-first"> · first of {pack.length}</span>}
        </p>
        {location && !confirmed.meetingUrl && (
          <p className="bk-confirmed-where">
            {directions ? (
              /* The whole line, not a separate "Directions" link beside it:
                 an address that looks tappable is tappable, which is what
                 somebody already running late will reach for. */
              <a className="bk-map-link" href={directions} target="_blank" rel="noreferrer">
                {location}
              </a>
            ) : (
              location
            )}
          </p>
        )}
        <p className="bk-confirmed-zone">{viewerZone}</p>
      </div>

      {confirmed.meetingUrl && (
        <a className="bk-join" href={confirmed.meetingUrl}>
          Join the video call
        </a>
      )}

      {packSize > 1 && pack.length > 1 && (
        <ol className="bk-pack-confirmed">
          {pack.map((booking, index) => (
            <li key={booking.manageToken}>
              <span className="bk-pack-n">{index + 1}</span>
              <span className="bk-pack-when">
                {formatInstantDay(booking.startsAt)},{' '}
                {formatTimeRange(booking.startsAt, durationMinutes)}
              </span>
              <a className="bk-textlink" href={`/manage/${booking.manageToken}`}>
                Change
              </a>
            </li>
          ))}
        </ol>
      )}

      <div className="bk-add">
        <p className="bk-add-label">
          {packSize > 1 ? 'Add them to your calendar' : 'Add it to your calendar'}
        </p>
        <div className="bk-add-actions">
          {packSize > 1 ? (
            /* One file, every appointment. No Google link beside it: their
               template URL carries exactly one event, and offering it here
               would quietly drop the other nine. .ics imports into Google
               Calendar too. */
            <button
              type="button"
              className="bk-textlink"
              onClick={() => downloadCalendar(packEvents)}
            >
              Download all {pack.length} appointments
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Which of these two shows is decided by whether an email really went
          out, not by whether one was meant to. Promising a confirmation that
          never left the building is the worst version of this screen: it is
          the person who believes it who arrives at no appointment, because
          they trusted the email instead of noting the time. */}
      {confirmed.confirmationEmailSent ? (
        <p className="bk-after">
          We&apos;ve sent a confirmation to <strong>{email}</strong> with{' '}
          {packSize > 1 ? 'every appointment' : 'everything you need'}
          {confirmed.meetingUrl
            ? packSize > 1
              ? ', including the video call links'
              : ', including the video call link'
            : ''}
          . Nothing arrived? Check your spam folder.{' '}
          {packSize > 1 ? (
            /* No "keep this link" here: there are as many links as there are
               appointments, they are listed above, and the email carries them
               too. Telling somebody to keep one of five would lose them four. */
            <>The email carries a link for each one, so nothing is lost if you close this page.</>
          ) : (
            <>
              You can <a href={`/manage/${confirmed.manageToken}`}>reschedule or cancel</a>{' '}
              here — worth keeping this link.
            </>
          )}
        </p>
      ) : (
        /* No email is coming, so this page is the only record. Said without
           alarm — a visitor cannot act on a mail server being down, and
           telling them it is would only make a booking that worked feel
           broken. What they can act on is keeping the link. */
        <p className="bk-after">
          {packSize > 1 ? (
            /* No single link to keep — each appointment has its own, and
               they are listed above. Telling somebody to save "this link"
               when there are ten would lose them nine. */
            <>
              Your appointments are confirmed. <strong>Keep this page</strong>, or
              add them to your calendar above — the links beside each one are how
              you&apos;ll change them later.
            </>
          ) : (
            <>
              Your booking is confirmed. <strong>Save this link</strong> — it&apos;s
              how you&apos;ll find, change or cancel it:{' '}
              <a href={`/manage/${confirmed.manageToken}`}>manage your booking</a>.
            </>
          )}
        </p>
      )}
    </section>
  );
}
