import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOURS,
  DEFAULT_WEEKDAYS,
  SERVICE_TYPES,
  areDefaultHours,
  hoursSummary,
  serviceTypeBody,
  setupItems,
  setupOpen,
  type SetupInput,
} from '../src/lib/setup';

const defaults = DEFAULT_WEEKDAYS.map((weekday) => ({
  weekday,
  startTime: `${DEFAULT_HOURS.start}:00`,
  endTime: `${DEFAULT_HOURS.end}:00`,
}));

describe('hours', () => {
  it('knows the hours a new account starts with, as stored', () => {
    expect(areDefaultHours(defaults)).toBe(true);
    expect(areDefaultHours(defaults.slice(0, 4))).toBe(false);
    expect(areDefaultHours([...defaults.slice(1), { weekday: 1, startTime: '10:00:00', endTime: '17:00:00' }])).toBe(false);
  });

  it('says the usual week in one line', () => {
    expect(hoursSummary(defaults)).toBe('Monday to Friday, 9:00–17:00');
    expect(hoursSummary([])).toBe('No opening hours');
    expect(
      hoursSummary([
        { weekday: 2, startTime: '10:00', endTime: '14:00' },
        { weekday: 4, startTime: '10:00', endTime: '14:00' },
        { weekday: 6, startTime: '09:00', endTime: '13:00' },
      ]),
    ).toBe('Tuesday and Thursday, 10:00–14:00; Saturday, 9:00–13:00');
    expect(
      hoursSummary([
        { weekday: 1, startTime: '09:00', endTime: '13:00' },
        { weekday: 1, startTime: '15:00', endTime: '19:00' },
        { weekday: 2, startTime: '09:00', endTime: '13:00' },
        { weekday: 2, startTime: '15:00', endTime: '19:00' },
      ]),
    ).toBe('Monday and Tuesday, 9:00–13:00 and 15:00–19:00');
  });
});

describe('service types', () => {
  it('fill in what is usual, and leave the rest to the business', () => {
    const intro = SERVICE_TYPES.find((t) => t.id === 'intro')!;
    expect(serviceTypeBody(intro, '  Discovery call ')).toEqual({
      name: 'Discovery call',
      durationMinutes: 20,
      locationKind: 'online',
      priceMinor: 0,
    });
    const programme = SERVICE_TYPES.find((t) => t.id === 'programme')!;
    expect(serviceTypeBody(programme, 'Coaching programme')).toMatchObject({ bookingMode: 'pack', packSize: 4 });
    const other = SERVICE_TYPES.find((t) => t.id === 'other')!;
    expect(serviceTypeBody(other, 'Website audit')).toEqual({ name: 'Website audit', durationMinutes: 30 });
  });
});

describe('setup checklist', () => {
  const fresh: SetupInput = {
    services: [],
    hours: defaults,
    calendarStatus: 'not_connected',
    branding: { logo: false, colour: false },
    everBooked: false,
    embedded: false,
  };

  it('starts a new account on its first service, with its hours named as a starting point', () => {
    const items = setupItems(fresh);
    expect(items.map((i) => [i.id, i.state])).toEqual([
      ['service', 'needed'],
      ['hours', 'done'],
      ['calendar', 'optional'],
      ['branding', 'optional'],
      ['share', 'optional'],
    ]);
    expect(items[0]!.action).toEqual({ label: 'Add a service', href: 'add-service' });
    expect(items[1]!.detail).toMatch(/Monday to Friday, 9:00–17:00, set for you to start/);
  });

  it('points a service nobody can book yet to its "Go live" step', () => {
    const items = setupItems({
      ...fresh,
      services: [{ id: 's1', name: 'Intro call', active: true, availableToProspects: false, availableToExistingClients: false }],
    });
    expect(items[0]).toMatchObject({ state: 'needed', action: { href: 'sessions/s1' } });
    expect(items[0]!.detail).toMatch(/Go live/);
  });

  it('asks for sharing once something is live, and says when hours are missing', () => {
    const items = setupItems({
      ...fresh,
      hours: [],
      services: [{ id: 's1', name: 'Intro call', active: true, availableToProspects: true, availableToExistingClients: false }],
    });
    expect(items.find((i) => i.id === 'service')!.state).toBe('done');
    expect(items.find((i) => i.id === 'hours')).toMatchObject({ state: 'needed', title: 'Set your opening hours' });
    expect(items.find((i) => i.id === 'share')!.state).toBe('needed');
  });

  it('closes once everything is done, and treats a broken calendar as needed', () => {
    const all: SetupInput = {
      services: [{ id: 's1', name: 'Intro call', active: true, availableToProspects: true, availableToExistingClients: false }],
      hours: [{ weekday: 2, startTime: '10:00', endTime: '14:00' }],
      calendarStatus: 'active',
      branding: { logo: true, colour: true },
      everBooked: true,
      embedded: false,
    };
    expect(setupOpen(setupItems(all))).toBe(false);
    const broken = setupItems({ ...all, calendarStatus: 'needs_reconnect' });
    expect(setupOpen(broken)).toBe(true);
    expect(broken.find((i) => i.id === 'calendar')!.state).toBe('needed');
  });
});

describe('the wizard week', () => {
  it('reads a week of one pattern, and leaves a mixed one alone', async () => {
    const { simpleWeek, weekBody } = await import('../src/lib/setup');
    expect(simpleWeek(defaults)).toEqual({ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' });
    expect(simpleWeek([])).toEqual({ days: [], start: '09:00', end: '17:00' });
    expect(
      simpleWeek([
        { weekday: 1, startTime: '09:00', endTime: '13:00' },
        { weekday: 1, startTime: '15:00', endTime: '19:00' },
      ]),
    ).toBeNull();
    const body = weekBody([2, 4], '10:00', '14:00');
    expect(body.days).toHaveLength(7);
    expect(body.days[1]).toEqual({ weekday: 2, windows: [{ startTime: '10:00', endTime: '14:00' }] });
    expect(body.days[0]).toEqual({ weekday: 1, windows: [] });
  });
});
