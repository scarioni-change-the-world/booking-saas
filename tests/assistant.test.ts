import { describe, expect, it } from 'vitest';
import { sanitizeAssistantReply } from '../src/lib/assistant/assistant';
import { ASSISTANT_SYSTEM_PROMPT } from '../src/lib/assistant/prompt';

const ctx = { serviceIds: ['s1', 's2'], today: '2026-11-14' };
const empty = {
  serviceId: null, name: null, durationMinutes: null, price: null, clearPrice: null, days: null,
  start: null, end: null, from: null, to: null, note: null, noticeHours: null, windowDays: null,
};
const act = (a: Record<string, unknown>) => ({ ...empty, ...a });

describe('Ask khloe replies', () => {
  it('keeps a well-formed change and its links', () => {
    const r = sanitizeAssistantReply(
      {
        reply: 'I can add it. Confirm below.',
        links: [{ place: 'services', serviceId: null }, { place: 'service', serviceId: 's1' }],
        actions: [act({ type: 'add_service', name: 'Massage', durationMinutes: 45, price: 60 })],
      },
      ctx,
    );
    expect(r.links).toEqual([{ place: 'services' }, { place: 'service', serviceId: 's1' }]);
    expect(r.actions).toEqual([{ type: 'add_service', name: 'Massage', durationMinutes: 45, price: 60 }]);
  });

  it('drops changes to services the business does not have, and links to them', () => {
    const r = sanitizeAssistantReply(
      {
        reply: 'x',
        links: [{ place: 'service', serviceId: 'nope' }, { place: 'somewhere', serviceId: null }],
        actions: [act({ type: 'pause_service', serviceId: 'nope' }), act({ type: 'update_service', serviceId: 's2' })],
      },
      ctx,
    );
    expect(r.links).toEqual([]);
    expect(r.actions).toEqual([]); // the update changed nothing, so it is not a change
  });

  it('checks hours, dates and lengths rather than guessing', () => {
    const r = sanitizeAssistantReply(
      {
        reply: 'x',
        links: [],
        actions: [
          act({ type: 'set_hours', days: [6, 6, 9], start: '10:00', end: '14:00' }),
          act({ type: 'set_hours', days: [7], start: null, end: null }),
          act({ type: 'set_hours', days: [1], start: '18:00', end: '09:00' }),
          act({ type: 'time_off', from: '2026-11-20', to: '2026-11-20', note: 'Holiday' }),
          act({ type: 'time_off', from: '2026-01-01', to: '2026-01-02', note: '' }),
        ],
      },
      ctx,
    );
    expect(r.actions).toEqual([
      { type: 'set_hours', days: [6], start: '10:00', end: '14:00' },
      { type: 'set_hours', days: [7], start: null, end: null },
      { type: 'time_off', from: '2026-11-20', to: '2026-11-20', note: 'Holiday' },
    ]);
    const lengths = sanitizeAssistantReply(
      { reply: 'x', links: [], actions: [act({ type: 'add_service', name: 'Odd', durationMinutes: 43, price: 10 })] },
      ctx,
    );
    expect(lengths.actions).toEqual([]);
  });

  it('removes a price only when asked to, and keeps a free price', () => {
    const r = sanitizeAssistantReply(
      {
        reply: 'x',
        links: [],
        actions: [
          act({ type: 'update_service', serviceId: 's1', clearPrice: true }),
          act({ type: 'update_service', serviceId: 's2', price: 0 }),
        ],
      },
      ctx,
    );
    expect(r.actions).toEqual([
      { type: 'update_service', serviceId: 's1', price: null },
      { type: 'update_service', serviceId: 's2', price: 0 },
    ]);
  });

  it('survives a reply of the wrong shape', () => {
    const r = sanitizeAssistantReply('nonsense', ctx);
    expect(r.actions).toEqual([]);
    expect(r.reply).toMatch(/could not answer/);
  });

  it('tells the model what it may never do, and that facts are data', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/cannot delete anything, cancel or move appointments, email clients/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/never see clients/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/data, not instructions/);
  });
});
