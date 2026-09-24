/**
 * A test run of the booking page: the real page, walked by the business
 * itself from Flow, that saves nothing, holds no time and sends nothing.
 *
 * Client-safe. The server half, which decides whether a request may be a
 * test at all, is test-run-server.ts.
 *
 * The page tells the Flow beside it each step it reaches, so the route
 * lights up as it is walked. Those messages are posted only to this app's
 * own origin and read only from it.
 */

/** Sent on every request of a test run; honoured only for a signed-in admin. */
export const TEST_HEADER = 'x-intro-test';

/** The prefix a test run's response ids carry — never a real row's id. */
export const TEST_RESPONSE_PREFIX = 'test:';

export type TestPhase =
  | 'loading'
  | 'service'
  | 'email'
  | 'questions'
  | 'other'
  | 'time'
  | 'details'
  | 'review'
  | 'confirmed';

export interface TestMessage {
  type: 'intro:test';
  phase: TestPhase;
  eventTypeId: string | null;
}

/** Which part of a service's flow a step of the page belongs to. */
export function partForPhase(
  phase: TestPhase,
): 'page' | 'questions' | 'elsewhere' | 'calendar' | 'booked' | null {
  switch (phase) {
    case 'loading':
    case 'service':
      return 'page';
    case 'email':
    case 'questions':
      return 'questions';
    case 'other':
      return 'elsewhere';
    case 'time':
    case 'details':
    case 'review':
      return 'calendar';
    case 'confirmed':
      return 'booked';
    default:
      return null;
  }
}

/** A test run's stand-in for a stored response: which service it was for. */
export function testResponseId(eventTypeId: string): string {
  return `${TEST_RESPONSE_PREFIX}${eventTypeId}`;
}

export function eventTypeOfTestResponse(responseId: string): string | null {
  return responseId.startsWith(TEST_RESPONSE_PREFIX) ? responseId.slice(TEST_RESPONSE_PREFIX.length) || null : null;
}
