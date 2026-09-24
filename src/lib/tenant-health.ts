/**
 * What is wrong with a business's account, said without looking inside it.
 *
 * The rule this file exists to keep: SHAPE, NEVER CONTENT. Counts,
 * booleans, timestamps and fixed enum values — never a client's name, an
 * email address, a question's wording, or anything anybody answered.
 *
 * It turns out that costs almost nothing, because support cases are
 * structural. "Nothing is available on my booking page" is always one of a
 * handful of configuration states, and you can tell which from numbers
 * alone. Reading somebody's client list to find out they have no opening
 * hours would be both a violation and a waste of time.
 *
 * The one place this could leak is an error message from a mail server or
 * a calendar API, which routinely names the recipient — a bounce reads
 * `550 5.1.1 <maya@example.com> user unknown`. Those strings never leave
 * the database: classifyError maps them to one of five fixed words and
 * returns nothing derived from the input. See its tests, which assert
 * exactly that.
 */

export type ErrorClass = 'rejected' | 'auth' | 'connection' | 'limit' | 'other';

const ERROR_LABELS: Record<ErrorClass, string> = {
  rejected: 'the address was rejected',
  auth: 'the mail or calendar account was refused',
  connection: 'the server could not be reached',
  limit: 'a sending or quota limit was hit',
  other: 'an unclassified error',
};

export function errorLabel(kind: ErrorClass): string {
  return ERROR_LABELS[kind];
}

/**
 * One of five words, chosen by what the message looks like, returning
 * nothing taken from it.
 *
 * Deliberately returns a value from a closed set rather than, say, the
 * first line of the message or an error code: a code is fine until the day
 * a provider puts the recipient in one. The only safe rule is that nothing
 * derived from the input crosses this boundary.
 */
export function classifyError(message: string | null | undefined): ErrorClass {
  if (!message) return 'other';
  const m = message.toLowerCase();

  /* Order matters. An auth failure often also says "rejected", and it is a
     different thing to go and fix: a wrong password is the business's
     settings, a rejected address is their client's inbox. */
  /* Stems, not whole words, and deliberately so: the first version of this
     anchored both ends and quietly failed on "Authentication" — the single
     most common word in a mail-server refusal — filing it under 'other'.
     A misclassification is not a leak, but it is the difference between
     telling somebody their password is wrong and telling them nothing. */
  if (/(auth|credential|password|unauthor|forbidden|invalid.?grant|\b401\b|\b403\b)/.test(m)) {
    return 'auth';
  }
  if (/(quota|rate.?limit|too many|\b429\b|throttl)/.test(m)) return 'limit';
  if (/(econnrefused|etimedout|enotfound|timed?.?out|socket|network|\bdns\b|getaddrinfo)/.test(m)) {
    return 'connection';
  }
  if (/(\b55[0-4]\b|recipient|mailbox|user unknown|reject|bounce|undeliver|relay)/.test(m)) {
    return 'rejected';
  }
  return 'other';
}

/** Everything the console reads about one business. All of it is shape. */
export interface TenantFacts {
  activeServices: number;
  /** Active, but with neither audience ticked — invisible to everybody. */
  servicesOfferedToNobody: number;
  /** Weekly opening hours, tenant-wide. Zero means nothing is bookable. */
  availabilityRuleCount: number;
  questionCount: number;
  /** Confirmation and reminder emails that failed, recently. */
  emailsFailed: number;
  emailErrorClasses: readonly ErrorClass[];
  /** Calendar writes that failed, recently. */
  syncsFailed: number;
  syncErrorClasses: readonly ErrorClass[];
  lastBookingAt: string | null;
  lastEnquiryAt: string | null;
  /** Bookings made, and enquiries started, in the window. Counts only. */
  bookingsInWindow: number;
  enquiriesInWindow: number;
  createdAt: string;
}

/**
 * How much attention this deserves.
 *
 * 'stopped' is reserved for states where the business cannot take a
 * booking at all, whatever else is true. Everything else is 'watch', and a
 * business with nothing wrong has no findings — an empty list is the good
 * outcome, not a green tick to hunt for.
 */
export type Severity = 'stopped' | 'watch';

export interface Finding {
  severity: Severity;
  /** What is wrong, in the words you would use on the phone. */
  headline: string;
  /** What to say or do about it. */
  detail?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dominant(classes: readonly ErrorClass[]): ErrorClass {
  const counts = new Map<ErrorClass, number>();
  for (const c of classes) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: ErrorClass = 'other';
  let bestCount = -1;
  for (const [kind, count] of counts) {
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return best;
}

function daysBetween(from: string, to: Date): number {
  return Math.floor((to.getTime() - new Date(from).getTime()) / DAY_MS);
}

/**
 * What is wrong here, worst first.
 *
 * Ordered by what it costs the business rather than by how alarming it
 * looks: a page that cannot be booked outranks a bounced email, which
 * outranks an account nobody has touched.
 */
export function diagnose(facts: TenantFacts, now: Date = new Date()): Finding[] {
  const findings: Finding[] = [];

  if (facts.activeServices === 0) {
    findings.push({
      severity: 'stopped',
      headline: 'No services',
      detail: 'Nothing exists to book. They have not started setting up.',
    });
  } else if (facts.availabilityRuleCount === 0) {
    findings.push({
      severity: 'stopped',
      headline: 'No opening hours',
      detail: 'Their booking page offers nothing, whatever else is set.',
    });
  } else if (facts.servicesOfferedToNobody === facts.activeServices) {
    findings.push({
      severity: 'stopped',
      headline: 'Every service is offered to nobody',
      detail: 'Both audience boxes are unticked on all of them, so the page is empty.',
    });
  } else if (facts.servicesOfferedToNobody > 0) {
    findings.push({
      severity: 'watch',
      headline:
        facts.servicesOfferedToNobody === 1
          ? '1 service is offered to nobody'
          : `${facts.servicesOfferedToNobody} services are offered to nobody`,
      detail: 'Probably unfinished rather than deliberate.',
    });
  }

  if (facts.emailsFailed > 0) {
    findings.push({
      severity: 'watch',
      headline:
        facts.emailsFailed === 1
          ? '1 email did not arrive'
          : `${facts.emailsFailed} emails did not arrive`,
      detail: `Most often, ${errorLabel(dominant(facts.emailErrorClasses))}.`,
    });
  }

  if (facts.syncsFailed > 0) {
    findings.push({
      severity: 'watch',
      headline:
        facts.syncsFailed === 1
          ? '1 booking never reached their calendar'
          : `${facts.syncsFailed} bookings never reached their calendar`,
      detail: `Most often, ${errorLabel(dominant(facts.syncErrorClasses))}.`,
    });
  }

  /* A page with no questions is a calendar with a form in front of it —
     which is a working booking page, and not what this product is for. */
  if (facts.activeServices > 0 && facts.questionCount === 0) {
    findings.push({
      severity: 'watch',
      headline: 'Nobody is asked anything',
      detail: 'No questions written, so the screening never runs.',
    });
  }

  /* Silence. Said last and only once the account has had a fair chance:
     an account set up yesterday with no bookings is not a problem. */
  const age = daysBetween(facts.createdAt, now);
  if (age >= 7 && !facts.lastBookingAt && !facts.lastEnquiryAt) {
    findings.push({
      severity: 'watch',
      headline: `Nothing has happened in ${age} days`,
      detail: 'No enquiries and no bookings since the account was made.',
    });
  }

  return findings;
}

/** The worst thing wrong here, or null when nothing is. */
export function severityOf(findings: readonly Finding[]): Severity | null {
  if (findings.some((f) => f.severity === 'stopped')) return 'stopped';
  if (findings.length > 0) return 'watch';
  return null;
}

/** Worst first, so a list of businesses reads as a queue. */
export function byUrgency<T extends { findings: readonly Finding[] }>(rows: T[]): T[] {
  const rank = (row: T) => {
    const s = severityOf(row.findings);
    return s === 'stopped' ? 0 : s === 'watch' ? 1 : 2;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.findings.length - a.findings.length);
}

/* ── The same facts, drawn as a small flow ───────────────────────────────
 *
 * The business's own Flow screen, reduced to five parts and redrawn from
 * the counts above — so a support person sees where the line breaks
 * without seeing a single client, address or answer. Still shape only:
 * everything here is computed from TenantFacts, which holds nothing else.
 */

export type MiniPartId = 'page' | 'questions' | 'services' | 'hours' | 'booked';

/**
 * 'ok' works; 'thin' works but is missing something worth a word;
 * 'broken' stops bookings; 'quiet' is the end of a line that works but
 * nothing has come through yet.
 */
export type MiniPartState = 'ok' | 'thin' | 'broken' | 'quiet';

export interface MiniPart {
  id: MiniPartId;
  label: string;
  state: MiniPartState;
  /** Said to a screen reader, and on hover. */
  note: string;
}

export interface MiniFlow {
  parts: MiniPart[];
  /** Whether the line into each part (after the first) is whole. */
  links: boolean[];
  /** One sentence, the way you would say it on the phone. */
  sentence: string;
}

export function miniFlow(facts: TenantFacts): MiniFlow {
  const noServices = facts.activeServices === 0;
  const allHidden = !noServices && facts.servicesOfferedToNobody === facts.activeServices;
  const someHidden = !noServices && !allHidden && facts.servicesOfferedToNobody > 0;
  const noHours = facts.availabilityRuleCount === 0;
  const delivery = facts.emailsFailed + facts.syncsFailed;

  const parts: MiniPart[] = [
    { id: 'page', label: 'page', state: 'ok', note: 'Their booking page is up' },
    {
      id: 'questions',
      label: 'questions',
      state: facts.questionCount === 0 ? 'thin' : 'ok',
      note: facts.questionCount === 0 ? 'Nobody is asked anything' : `${facts.questionCount} questions`,
    },
    {
      id: 'services',
      label: 'service',
      state: noServices || allHidden ? 'broken' : someHidden ? 'thin' : 'ok',
      note: noServices
        ? 'No services'
        : allHidden
          ? 'Every service is offered to nobody'
          : someHidden
            ? `${facts.servicesOfferedToNobody} of ${facts.activeServices} offered to nobody`
            : `${facts.activeServices} ${facts.activeServices === 1 ? 'service' : 'services'}`,
    },
    {
      id: 'hours',
      label: 'hours',
      state: noHours ? 'broken' : 'ok',
      note: noHours ? 'No opening hours' : 'Opening hours set',
    },
    {
      id: 'booked',
      label: 'booked',
      state: delivery > 0 ? 'thin' : facts.bookingsInWindow > 0 ? 'ok' : 'quiet',
      note:
        facts.bookingsInWindow > 0
          ? `${facts.bookingsInWindow} ${facts.bookingsInWindow === 1 ? 'booking' : 'bookings'} recently`
          : 'No bookings recently',
    },
  ];

  /* Everything after the first break is cut: a booking cannot get past a
     part that stops it, whatever is set further along. */
  const firstBreak = parts.findIndex((p) => p.state === 'broken');
  const links = parts.slice(1).map((_, i) => firstBreak === -1 || i + 1 < firstBreak);

  return { parts, links, sentence: flowSentence(facts, parts, firstBreak) };
}

function flowSentence(facts: TenantFacts, parts: MiniPart[], firstBreak: number): string {
  if (firstBreak !== -1) {
    const part = parts[firstBreak]!;
    if (part.id === 'services') {
      return facts.activeServices === 0
        ? 'No services yet. Nothing exists to book.'
        : 'Every service is offered to nobody, so the page is empty.';
    }
    return 'No opening hours. The page offers nothing.';
  }

  const delivery: string[] = [];
  if (facts.emailsFailed > 0) {
    delivery.push(`${facts.emailsFailed} ${facts.emailsFailed === 1 ? 'email' : 'emails'} did not arrive`);
  }
  if (facts.syncsFailed > 0) {
    delivery.push(`${facts.syncsFailed} ${facts.syncsFailed === 1 ? 'booking' : 'bookings'} missed their calendar`);
  }
  const traffic =
    facts.bookingsInWindow > 0
      ? `${facts.bookingsInWindow} ${facts.bookingsInWindow === 1 ? 'booking' : 'bookings'} recently`
      : facts.enquiriesInWindow > 0
        ? `${facts.enquiriesInWindow} ${facts.enquiriesInWindow === 1 ? 'enquiry' : 'enquiries'}, no bookings yet`
        : 'nothing has come through yet';

  const opening = facts.questionCount === 0 ? 'Nobody is asked anything' : 'Connected end to end';
  const rest = [traffic, ...delivery].join('; ');
  return `${opening}. ${rest.charAt(0).toUpperCase()}${rest.slice(1)}.`;
}
