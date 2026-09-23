/**
 * What is left to decide about a service, and in what order.
 *
 * Creating a service takes one text field, and the result is a row that
 * looks finished and is offered to nobody. `available_to_prospects` and
 * `available_to_existing_clients` both default to false (migration 0002),
 * so a brand-new service does not appear on the booking page, is not
 * bookable, and nothing on screen says so. A business finds out on day
 * three, when a client tells them.
 *
 * Everything here is DERIVED from facts already in the database. There is
 * no `setup_step` column and no "wizard progress" to get out of step with
 * reality: a service is as finished as its own fields say it is, whether
 * those fields were filled in through the setup path or by editing the row
 * directly afterwards. That also means the order below is advice, not a
 * state machine — a person can do these in any order, skip any of them, and
 * come back months later, and this still describes where they are.
 */

/** Deliberately not 'setup complete': see `blocking` on Stage. */
export type StageId = 'service' | 'questions' | 'rules' | 'availability' | 'messages' | 'review';

export interface ServiceFacts {
  /** Needed so the Questions stage can link at this service rather than at
   *  the whole question set. See questionsStage. */
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMinor: number | null;
  locationKind: string | null;
  locationDetail: string | null;
  bookingMode: 'single' | 'pack';
  packSize: number | null;
  availableToProspects: boolean;
  availableToExistingClients: boolean;
  /** Questions asked only for this service. */
  ownQuestionCount: number;
  /** Questions asked for every prospect-facing service. */
  globalQuestionCount: number;
  /**
   * Weekly opening hours the business has, anywhere. Tenant-wide rather
   * than per service — the slot engine reads one set of hours for the whole
   * business — so this stage asks "can anything be booked at all", which is
   * the question that actually blocks.
   */
  availabilityRuleCount: number;
  /** Whether the other path has something to say for itself. */
  hasOtherPathMessage: boolean;
  /** Whether the other path at least sends people somewhere. */
  hasOtherPathUrl: boolean;
}

export interface Stage {
  id: StageId;
  label: string;
  /** What this stage decides, said once, in the words a person would use. */
  purpose: string;
  /** Nothing here is still waiting on a decision. */
  done: boolean;
  /**
   * What is unset, and what that costs — never a bare "incomplete". Empty
   * when there is nothing to say.
   */
  note: string;
  /**
   * Left unset, this stops the service working at all, as opposed to
   * leaving it thinner than it could be.
   *
   * Only two things qualify, and both are absolute: a business with no
   * hours has nothing to offer, and a service offered to nobody cannot be
   * reached. Everything else — no questions, no price, no location, no
   * message on the other path — describes a service that works and could
   * be better, and calling those "incomplete" would train somebody to
   * ignore the word.
   */
  blocking: boolean;
  /**
   * Where the work happens, relative to /admin/<slug>/. Null when the
   * setup path edits it in place, because the surface is three fields
   * rather than a screen of its own.
   */
  href: string | null;
  /**
   * Whether this is decided for this service or once for the whole
   * business.
   *
   * Opening hours and the other path's message are tenant-wide: one set of
   * each, shared by everything. Repeating "no opening hours anywhere" on
   * every row of a list of five services says one fact five times and
   * buries what is actually different between them, so a list shows only
   * the service-scoped stages and says the business-wide ones once, above.
   */
  scope: 'service' | 'business';
}

function serviceStage(facts: ServiceFacts): Stage {
  /* Name and duration exist from the moment of creation, so the only thing
     genuinely open here is the description — which is what a stranger reads
     under the name when deciding whether this is the thing they want. */
  const hasDescription = (facts.description ?? '').trim().length > 0;
  return {
    id: 'service',
    label: 'Service',
    purpose: 'What it is called, and what people are told it is.',
    done: hasDescription,
    note: hasDescription
      ? ''
      : 'No description. People choosing between your services see only the name.',
    blocking: false,
    href: null,
    scope: 'service',
  };
}

function questionsStage(facts: ServiceFacts): Stage {
  const total = facts.ownQuestionCount + facts.globalQuestionCount;
  const own = facts.ownQuestionCount;

  /* Second, before the booking rules, because what you are screening for is
     what tells you whether this is a twenty-minute call or a half-day
     workshop. Picking the duration first and writing questions to fit it is
     the wrong way round, and it is the order a form would impose. */
  if (total === 0) {
    return {
      id: 'questions',
      label: 'Questions',
      purpose: 'What you need to know before you will open your calendar.',
      done: false,
      note: 'Nobody is asked anything. This service is a calendar with a booking form in front of it.',
      blocking: false,
      href: `screening?service=${encodeURIComponent(facts.id)}`,
      scope: 'service',
    };
  }

  return {
    id: 'questions',
    label: 'Questions',
    purpose: 'What you need to know before you will open your calendar.',
    done: true,
    note:
      own === 0
        ? `Asked the ${facts.globalQuestionCount} questions every service asks. Nothing specific to this one.`
        : '',
    blocking: false,
    /* At this service, not at the question set. The screen shows the
       shared questions and this one's own together — which is the order a
       client meets them in — but it arrives already knowing which service
       you came from, rather than asking you to find it in a dropdown. */
    href: `screening?service=${encodeURIComponent(facts.id)}`,
    scope: 'service',
  };
}

function rulesStage(facts: ServiceFacts): Stage {
  const noPrice = facts.priceMinor === null;
  const noLocation = !facts.locationKind;
  /* A pack that never says how many is the one genuinely broken state this
     stage can be in — the booking flow cannot ask for "some" appointments. */
  const brokenPack = facts.bookingMode === 'pack' && !facts.packSize;

  /* Written out per case rather than joined from fragments. A list glued
     together reads as a list of tags ("no price and no location"); these
     are sentences, and each one says what the gap costs rather than only
     that it is there. */
  let note = '';
  if (brokenPack) {
    note = 'Sold as a programme but with no number of appointments set.';
  } else if (noPrice && noLocation) {
    note = 'No price and no location — the two things a stranger looks for first.';
  } else if (noPrice) {
    note = 'No price. People decide whether to read on by what something costs.';
  } else if (noLocation) {
    note = 'No location. Nobody can tell whether this is online or somewhere they travel to.';
  }

  return {
    id: 'rules',
    label: 'Booking rules',
    purpose: 'How long, how much, where, and whether it is sold as a programme.',
    done: note === '',
    note,
    blocking: brokenPack,
    href: null,
    scope: 'service',
  };
}

function availabilityStage(facts: ServiceFacts): Stage {
  const has = facts.availabilityRuleCount > 0;
  return {
    id: 'availability',
    label: 'Availability',
    purpose: 'The hours you are open. Shared by every service you offer.',
    done: has,
    note: has ? '' : 'No opening hours anywhere, so nothing can be booked.',
    blocking: !has,
    href: 'availability',
    scope: 'business',
  };
}

function messagesStage(facts: ServiceFacts): Stage {
  /* The empty grey card a real client was shown: the other path rendered a
     resource card with nothing in it, under a sentence whose "this" pointed
     at nothing. Fixed on the client's side, but the reason it happened is
     that nothing ever asked the business to write it. */
  const said = facts.hasOtherPathMessage || facts.hasOtherPathUrl;
  return {
    id: 'messages',
    label: 'Messages',
    purpose: 'What people are told — including the ones you do not meet.',
    done: said,
    note: said
      ? ''
      : 'Nothing written for people sent elsewhere. They are told a meeting is not the next step, and nothing else.',
    blocking: false,
    href: 'screening/next-steps',
    scope: 'business',
  };
}

function reviewStage(facts: ServiceFacts): Stage {
  const live = facts.availableToProspects || facts.availableToExistingClients;

  if (!live) {
    return {
      id: 'review',
      label: 'Go live',
      purpose: 'Who is offered this, and from when.',
      done: false,
      note: 'Offered to nobody. It does not appear on your booking page.',
      blocking: true,
      href: null,
      scope: 'service',
    };
  }

  const who = facts.availableToProspects
    ? facts.availableToExistingClients
      ? 'new enquiries and existing clients'
      : 'new enquiries'
    : 'existing clients';

  return {
    id: 'review',
    label: 'Go live',
    purpose: 'Who is offered this, and from when.',
    done: true,
    note: `Offered to ${who}.`,
    blocking: false,
    href: null,
    scope: 'service',
  };
}

/** The six stages, in the order each one's answer informs the next. */
export function setupStages(facts: ServiceFacts): Stage[] {
  return [
    serviceStage(facts),
    questionsStage(facts),
    rulesStage(facts),
    availabilityStage(facts),
    messagesStage(facts),
    reviewStage(facts),
  ];
}

/** The stages that stop this service working, in stage order. */
export function blockers(stages: readonly Stage[]): Stage[] {
  return stages.filter((stage) => stage.blocking);
}

/** Everything unset that is worth doing but is not stopping anything. */
export function loose(stages: readonly Stage[]): Stage[] {
  return stages.filter((stage) => !stage.done && !stage.blocking);
}

/**
 * The one line a Services row carries.
 *
 * Says the blocking thing plainly when there is one, because "2 things
 * unset" beside a service that cannot be booked buries the only sentence
 * that matters. Counts the rest, because a row is not the place to list
 * them.
 */
export function summarise(stages: readonly Stage[]): string | null {
  const stopped = blockers(stages);
  const rest = loose(stages);

  if (stopped.length === 0 && rest.length === 0) return null;

  if (stopped.length > 0) {
    const first = stopped[0]!.note;
    if (stopped.length === 1 && rest.length === 0) return first;
    const others = stopped.length - 1 + rest.length;
    return `${first} ${others === 1 ? '1 other thing' : `${others} other things`} unset.`;
  }

  return rest.length === 1 ? rest[0]!.note : `${rest.length} things worth setting.`;
}

/** The stages this service decides for itself. */
export function ownStages(stages: readonly Stage[]): Stage[] {
  return stages.filter((stage) => stage.scope === 'service');
}

/** The stages decided once for the whole business. */
export function businessStages(stages: readonly Stage[]): Stage[] {
  return stages.filter((stage) => stage.scope === 'business');
}

/** Whether anybody at all can be offered this service. */
export function isLive(facts: ServiceFacts): boolean {
  return facts.availableToProspects || facts.availableToExistingClients;
}
