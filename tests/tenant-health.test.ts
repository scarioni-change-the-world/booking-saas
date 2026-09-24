import { describe, expect, it } from 'vitest';
import {
  byUrgency,
  classifyError,
  diagnose,
  errorLabel,
  severityOf,
  type ErrorClass,
  type TenantFacts,
  miniFlow,
} from '@/lib/tenant-health';

const NOW = new Date('2026-09-23T12:00:00Z');

const healthy: TenantFacts = {
  activeServices: 3,
  servicesOfferedToNobody: 0,
  availabilityRuleCount: 5,
  questionCount: 4,
  emailsFailed: 0,
  emailErrorClasses: [],
  syncsFailed: 0,
  syncErrorClasses: [],
  lastBookingAt: '2026-09-22T09:00:00Z',
  lastEnquiryAt: '2026-09-22T08:00:00Z',
  bookingsInWindow: 6,
  enquiriesInWindow: 9,
  createdAt: '2026-01-01T00:00:00Z',
};

/**
 * The reason this file exists.
 *
 * A mail server's rejection routinely names the person it could not reach,
 * and those strings sit in bookings.email_error. If any part of one can
 * reach a screen that spans every business on the platform, a support tool
 * has become a way to read somebody's client list one bounce at a time.
 */
describe('classifyError never returns anything from its input', () => {
  const dangerous = [
    '550 5.1.1 <maya.ruiz@gmail.com> user unknown',
    'SMTP error from remote server: 553 sorry, relaying denied for jordan@acme.co.uk',
    'Invalid grant for account coach@studio.es — please reconnect',
    'getaddrinfo ENOTFOUND smtp.andres-personal-domain.com',
    'Rate limit exceeded for project photographer-madrid-2019',
    'Unexpected failure booking SÃ¡nchez, Mª Ã ngeles',
  ];

  const ALLOWED: ErrorClass[] = ['rejected', 'auth', 'connection', 'limit', 'other'];

  it('answers with one of five fixed words, whatever it is given', () => {
    for (const message of dangerous) {
      expect(ALLOWED).toContain(classifyError(message));
    }
  });

  it('leaks no recognisable fragment of the message', () => {
    for (const message of dangerous) {
      const out = `${classifyError(message)} ${errorLabel(classifyError(message))}`;
      /* Every run of four or more letters/digits in the input — names,
         domains, local parts, project ids — must be absent from what comes
         back out. */
      for (const token of message.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []) {
        if (['user', 'unknown', 'error', 'from', 'remote', 'server', 'sorry',
             'relaying', 'denied', 'invalid', 'grant', 'account', 'please',
             'reconnect', 'exceeded', 'limit', 'rate', 'project', 'unexpected',
             'failure', 'booking', 'smtp'].includes(token)) {
          continue; // ordinary English that may legitimately appear in a label
        }
        expect(out).not.toContain(token);
      }
    }
  });

  it('never returns an @ or a dot-separated host', () => {
    for (const message of dangerous) {
      const out = `${classifyError(message)} ${errorLabel(classifyError(message))}`;
      expect(out).not.toContain('@');
      expect(out).not.toMatch(/\w+\.\w{2,}/);
    }
  });

  it('classifies an empty or missing message rather than throwing', () => {
    expect(classifyError(null)).toBe('other');
    expect(classifyError(undefined)).toBe('other');
    expect(classifyError('')).toBe('other');
  });
});

describe('classifyError puts messages in the right box', () => {
  it('separates a refused account from a refused address', () => {
    /* Different people fix these. A wrong password is the business's own
       settings; a rejected address is their client's inbox. */
    expect(classifyError('535 Authentication credentials invalid')).toBe('auth');
    expect(classifyError('550 mailbox unavailable')).toBe('rejected');
  });

  it('recognises a network failure', () => {
    expect(classifyError('connect ECONNREFUSED 10.0.0.1:587')).toBe('connection');
  });

  it('recognises a quota', () => {
    expect(classifyError('429 Too Many Requests')).toBe('limit');
  });
});

describe('diagnose', () => {
  it('finds nothing wrong with a working account', () => {
    expect(diagnose(healthy, NOW)).toEqual([]);
    expect(severityOf(diagnose(healthy, NOW))).toBeNull();
  });

  it('calls no opening hours stopped, because nothing can be booked', () => {
    const f = diagnose({ ...healthy, availabilityRuleCount: 0 }, NOW);
    expect(f[0]!.severity).toBe('stopped');
    expect(f[0]!.headline).toBe('No opening hours');
  });

  it('calls an empty account stopped, and does not also complain about hours', () => {
    const f = diagnose(
      { ...healthy, activeServices: 0, availabilityRuleCount: 0, questionCount: 0 },
      NOW,
    );
    expect(f.filter((x) => x.severity === 'stopped')).toHaveLength(1);
    expect(f[0]!.headline).toBe('No services');
  });

  it('separates every service being hidden from some of them being hidden', () => {
    const all = diagnose({ ...healthy, servicesOfferedToNobody: 3 }, NOW);
    expect(all[0]!.severity).toBe('stopped');

    const some = diagnose({ ...healthy, servicesOfferedToNobody: 1 }, NOW);
    expect(some[0]!.severity).toBe('watch');
    expect(some[0]!.headline).toBe('1 service is offered to nobody');
  });

  it('reports failed email with the dominant class and no message', () => {
    const f = diagnose(
      {
        ...healthy,
        emailsFailed: 12,
        emailErrorClasses: ['rejected', 'rejected', 'auth'],
      },
      NOW,
    );
    const email = f.find((x) => x.headline.includes('emails'))!;
    expect(email.headline).toBe('12 emails did not arrive');
    expect(email.detail).toBe('Most often, the address was rejected.');
  });

  it('does not call a brand-new quiet account a problem', () => {
    const fresh = diagnose(
      {
        ...healthy,
        lastBookingAt: null,
        lastEnquiryAt: null,
        createdAt: '2026-09-21T00:00:00Z',
      },
      NOW,
    );
    expect(fresh.some((x) => x.headline.includes('Nothing has happened'))).toBe(false);
  });

  it('does call a fortnight of silence a problem', () => {
    const quiet = diagnose(
      {
        ...healthy,
        lastBookingAt: null,
        lastEnquiryAt: null,
        createdAt: '2026-09-09T00:00:00Z',
      },
      NOW,
    );
    expect(quiet.some((x) => x.headline === 'Nothing has happened in 14 days')).toBe(true);
  });
});

describe('byUrgency', () => {
  it('puts a stopped business above a watched one above a working one', () => {
    const rows = [
      { id: 'fine', findings: diagnose(healthy, NOW) },
      { id: 'watch', findings: diagnose({ ...healthy, emailsFailed: 2 }, NOW) },
      { id: 'stopped', findings: diagnose({ ...healthy, availabilityRuleCount: 0 }, NOW) },
    ];
    expect(byUrgency(rows).map((r) => r.id)).toEqual(['stopped', 'watch', 'fine']);
  });
});

describe('miniFlow', () => {
  it('is whole end to end for a business with nothing wrong', () => {
    const flow = miniFlow(healthy);
    expect(flow.parts.map((p) => p.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(flow.links).toEqual([true, true, true, true]);
    expect(flow.sentence).toBe('Connected end to end. 6 bookings recently.');
  });

  it('breaks the line at the first part that stops bookings, and keeps it broken after', () => {
    const flow = miniFlow({ ...healthy, availabilityRuleCount: 0, bookingsInWindow: 0 });
    expect(flow.parts.find((p) => p.id === 'hours')!.state).toBe('broken');
    expect(flow.links).toEqual([true, true, false, false]);
    expect(flow.sentence).toBe('No opening hours. The page offers nothing.');
  });

  it('breaks at services before hours when both are missing', () => {
    const flow = miniFlow({ ...healthy, activeServices: 0, availabilityRuleCount: 0 });
    expect(flow.links).toEqual([true, false, false, false]);
    expect(flow.sentence).toBe('No services yet. Nothing exists to book.');
  });

  it('draws a thin part without breaking the line', () => {
    const flow = miniFlow({ ...healthy, questionCount: 0 });
    expect(flow.parts[1]!.state).toBe('thin');
    expect(flow.links.every(Boolean)).toBe(true);
    expect(flow.sentence).toBe('Nobody is asked anything. 6 bookings recently.');
  });

  it('says what went wrong with delivery, as counts', () => {
    const flow = miniFlow({ ...healthy, emailsFailed: 3 });
    expect(flow.parts[4]!.state).toBe('thin');
    expect(flow.sentence).toBe('Connected end to end. 6 bookings recently; 3 emails did not arrive.');
  });

  it('is quiet at the end when nothing has come through, and says so', () => {
    const flow = miniFlow({ ...healthy, bookingsInWindow: 0, enquiriesInWindow: 0 });
    expect(flow.parts[4]!.state).toBe('quiet');
    expect(flow.sentence).toBe('Connected end to end. Nothing has come through yet.');
  });

  it('holds nothing but counts and fixed words', () => {
    const flow = miniFlow({ ...healthy, emailsFailed: 1, emailErrorClasses: ['rejected'] });
    expect(JSON.stringify(flow)).not.toMatch(/@/);
  });
});
