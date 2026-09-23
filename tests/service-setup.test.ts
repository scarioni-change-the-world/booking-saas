import { describe, expect, it } from 'vitest';
import {
  blockers,
  businessStages,
  isLive,
  loose,
  ownStages,
  setupStages,
  summarise,
  type ServiceFacts,
} from '@/lib/service-setup';

/** A service with everything decided. Tests take this and remove one thing. */
const complete: ServiceFacts = {
  id: 'svc-1',
  name: 'Career coaching',
  description: 'A first conversation about where you want to get to.',
  durationMinutes: 50,
  priceMinor: 7000,
  locationKind: 'online',
  locationDetail: null,
  bookingMode: 'single',
  packSize: null,
  availableToProspects: true,
  availableToExistingClients: false,
  ownQuestionCount: 3,
  globalQuestionCount: 0,
  availabilityRuleCount: 5,
  hasOtherPathMessage: true,
  hasOtherPathUrl: false,
};

/** What "+ Add" actually produces: a name, and defaults for everything else. */
const justCreated: ServiceFacts = {
  id: 'svc-2',
  name: 'Website design',
  description: null,
  durationMinutes: 30,
  priceMinor: null,
  locationKind: null,
  locationDetail: null,
  bookingMode: 'single',
  packSize: null,
  availableToProspects: false,
  availableToExistingClients: false,
  ownQuestionCount: 0,
  globalQuestionCount: 0,
  availabilityRuleCount: 0,
  hasOtherPathMessage: false,
  hasOtherPathUrl: false,
};

describe('setupStages', () => {
  it('walks the six stages in the order each answer informs the next', () => {
    expect(setupStages(complete).map((s) => s.id)).toEqual([
      'service',
      'questions',
      'rules',
      'availability',
      'messages',
      'review',
    ]);
  });

  it('asks what you are screening for before how long the meeting is', () => {
    const ids = setupStages(complete).map((s) => s.id);
    expect(ids.indexOf('questions')).toBeLessThan(ids.indexOf('rules'));
  });

  it('finds nothing left on a service that is fully decided', () => {
    const stages = setupStages(complete);
    expect(stages.every((s) => s.done)).toBe(true);
    expect(summarise(stages)).toBeNull();
  });
});

describe('a service straight out of + Add', () => {
  const stages = setupStages(justCreated);

  it('is offered to nobody', () => {
    expect(isLive(justCreated)).toBe(false);
  });

  it('is stopped by exactly the two things that stop it', () => {
    expect(blockers(stages).map((s) => s.id)).toEqual(['availability', 'review']);
  });

  it('does not call a missing price or missing questions a blocker', () => {
    const ids = blockers(stages).map((s) => s.id);
    expect(ids).not.toContain('rules');
    expect(ids).not.toContain('questions');
    expect(ids).not.toContain('service');
  });

  it('leads with the thing that stops it, not a count', () => {
    const line = summarise(stages)!;
    expect(line.startsWith('No opening hours anywhere')).toBe(true);
    expect(line).toContain('other things');
  });
});

describe('what blocks and what does not', () => {
  it('treats no opening hours as blocking, because nothing can be booked', () => {
    const stages = setupStages({ ...complete, availabilityRuleCount: 0 });
    expect(blockers(stages).map((s) => s.id)).toEqual(['availability']);
  });

  it('treats offered-to-nobody as blocking, because it cannot be reached', () => {
    const stages = setupStages({
      ...complete,
      availableToProspects: false,
      availableToExistingClients: false,
    });
    expect(blockers(stages).map((s) => s.id)).toEqual(['review']);
  });

  it('treats a programme with no size as blocking — the flow cannot ask for "some"', () => {
    const stages = setupStages({ ...complete, bookingMode: 'pack', packSize: null });
    expect(blockers(stages).map((s) => s.id)).toEqual(['rules']);
  });

  it('accepts a programme that says how many', () => {
    const stages = setupStages({ ...complete, bookingMode: 'pack', packSize: 10 });
    expect(blockers(stages)).toEqual([]);
  });

  it('does not block on a missing price, which is a thinner page, not a broken one', () => {
    const stages = setupStages({ ...complete, priceMinor: null });
    expect(blockers(stages)).toEqual([]);
    expect(loose(stages).map((s) => s.id)).toEqual(['rules']);
  });
});

describe('the notes', () => {
  it('says what a missing description costs, not that it is missing', () => {
    const [service] = setupStages({ ...complete, description: null });
    expect(service!.note).toContain('see only the name');
  });

  it('treats whitespace as no description', () => {
    const [service] = setupStages({ ...complete, description: '   ' });
    expect(service!.done).toBe(false);
  });

  it('counts a service with only global questions as asked, but says so', () => {
    const stages = setupStages({ ...complete, ownQuestionCount: 0, globalQuestionCount: 2 });
    const questions = stages.find((s) => s.id === 'questions')!;
    expect(questions.done).toBe(true);
    expect(questions.note).toContain('Nothing specific to this one');
  });

  it('calls a service with no questions at all a calendar with a form in front', () => {
    const stages = setupStages({ ...complete, ownQuestionCount: 0, globalQuestionCount: 0 });
    const questions = stages.find((s) => s.id === 'questions')!;
    expect(questions.done).toBe(false);
    expect(questions.note).toContain('calendar');
  });

  it('accepts a URL alone as having something to say on the other path', () => {
    const stages = setupStages({
      ...complete,
      hasOtherPathMessage: false,
      hasOtherPathUrl: true,
    });
    expect(stages.find((s) => s.id === 'messages')!.done).toBe(true);
  });

  it('names who a live service is offered to', () => {
    const both = setupStages({ ...complete, availableToExistingClients: true });
    expect(both.find((s) => s.id === 'review')!.note).toBe(
      'Offered to new enquiries and existing clients.',
    );

    const clientsOnly = setupStages({
      ...complete,
      availableToProspects: false,
      availableToExistingClients: true,
    });
    expect(clientsOnly.find((s) => s.id === 'review')!.note).toBe(
      'Offered to existing clients.',
    );
  });
});

describe('summarise', () => {
  it('says nothing about a finished service', () => {
    expect(summarise(setupStages(complete))).toBeNull();
  });

  it('gives the whole sentence when one thing is loose', () => {
    const stages = setupStages({ ...complete, priceMinor: null });
    expect(summarise(stages)).toContain('No price');
  });

  it('counts when several things are loose but nothing is stopped', () => {
    const stages = setupStages({ ...complete, priceMinor: null, description: null });
    expect(summarise(stages)).toBe('2 things worth setting.');
  });

  it('gives the blocking sentence alone when it is the only thing', () => {
    const stages = setupStages({
      ...complete,
      availableToProspects: false,
      availableToExistingClients: false,
    });
    expect(summarise(stages)).toBe('Offered to nobody. It does not appear on your booking page.');
  });

  it('never buries a blocker behind a count', () => {
    const stages = setupStages({ ...complete, availabilityRuleCount: 0, priceMinor: null });
    expect(summarise(stages)!.startsWith('No opening hours')).toBe(true);
  });
});

describe('where the work happens', () => {
  it('keeps the short surfaces on the setup page itself', () => {
    const stages = setupStages(complete);
    for (const id of ['service', 'rules', 'review']) {
      expect(stages.find((s) => s.id === id)!.href).toBeNull();
    }
  });

  it('sends the big ones to the screens that already exist', () => {
    const stages = setupStages(complete);
    expect(stages.find((s) => s.id === 'questions')!.href).toBe('screening?service=svc-1');
    expect(stages.find((s) => s.id === 'availability')!.href).toBe('availability');
    expect(stages.find((s) => s.id === 'messages')!.href).toBe('screening/next-steps');
  });
});

describe('the booking-rules sentence', () => {
  const base: ServiceFacts = { ...complete };

  it('names both when both are missing', () => {
    const stages = setupStages({ ...base, priceMinor: null, locationKind: null });
    expect(stages.find((s) => s.id === 'rules')!.note).toBe(
      'No price and no location — the two things a stranger looks for first.',
    );
  });

  it('says what a missing price alone costs, as a sentence', () => {
    const note = setupStages({ ...base, priceMinor: null }).find((s) => s.id === 'rules')!.note;
    expect(note.startsWith('No price.')).toBe(true);
    expect(note).not.toContain('two things');
  });

  it('says what a missing location alone costs, as a sentence', () => {
    const note = setupStages({ ...base, locationKind: null }).find((s) => s.id === 'rules')!.note;
    expect(note.startsWith('No location.')).toBe(true);
  });

  it('never opens a note in lower case', () => {
    const cases: ServiceFacts[] = [
      justCreated,
      { ...base, priceMinor: null },
      { ...base, locationKind: null },
      { ...base, priceMinor: null, locationKind: null },
      { ...base, bookingMode: 'pack', packSize: null },
      { ...base, description: null },
      { ...base, ownQuestionCount: 0, globalQuestionCount: 0 },
      { ...base, availabilityRuleCount: 0 },
      { ...base, hasOtherPathMessage: false, hasOtherPathUrl: false },
      { ...base, availableToProspects: false, availableToExistingClients: false },
    ];
    for (const facts of cases) {
      for (const stage of setupStages(facts)) {
        if (!stage.note) continue;
        expect(stage.note[0]).toBe(stage.note[0]!.toUpperCase());
      }
    }
  });
});

describe('what belongs to the business rather than the service', () => {
  it('puts opening hours and the other-path message on the business', () => {
    expect(businessStages(setupStages(complete)).map((s) => s.id)).toEqual([
      'availability',
      'messages',
    ]);
  });

  it('leaves everything a service decides for itself on the service', () => {
    expect(ownStages(setupStages(complete)).map((s) => s.id)).toEqual([
      'service',
      'questions',
      'rules',
      'review',
    ]);
  });

  it('does not let a business-wide gap speak for a service on a list', () => {
    /* Every row of a five-service list leading with "no opening hours
       anywhere" says one fact five times and buries what is different
       between them. A row summarises only its own stages. */
    const stages = ownStages(setupStages({ ...complete, availabilityRuleCount: 0 }));
    expect(summarise(stages)).toBeNull();
  });

  it('still reports the business-wide gap on the service page, where all six show', () => {
    const stages = setupStages({ ...complete, availabilityRuleCount: 0 });
    expect(summarise(stages)).toContain('No opening hours');
  });
});

describe('where the Questions stage sends you', () => {
  it('points at this service, not at the whole question set', () => {
    const stages = setupStages({ ...complete, id: 'svc-9' });
    expect(stages.find((s) => s.id === 'questions')!.href).toBe('screening?service=svc-9');
  });

  it('points there whether or not the service has any questions yet', () => {
    const none = setupStages({ ...complete, ownQuestionCount: 0, globalQuestionCount: 0 });
    expect(none.find((s) => s.id === 'questions')!.href).toBe('screening?service=svc-1');
  });

  it('escapes an id rather than pasting it into a URL', () => {
    const stages = setupStages({ ...complete, id: 'a b&c' });
    expect(stages.find((s) => s.id === 'questions')!.href).toBe('screening?service=a%20b%26c');
  });
});
