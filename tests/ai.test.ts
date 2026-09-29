import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicAiProvider } from '@/lib/ai/anthropic';
import { AiUnavailableError } from '@/lib/ai/provider';

/** Mirrors tests/google.test.ts's mockFetch: a queue of responses, every
 * request recorded, so a test can both drive the provider and assert on
 * what it actually sent. */
function mockFetch(responses: Array<{ status?: number; json?: unknown; text?: string }>) {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  let index = 0;

  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });

    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;

    return {
      ok: (next?.status ?? 200) < 400,
      status: next?.status ?? 200,
      json: async () => next?.json ?? {},
      text: async () => next?.text ?? '',
    } as Response;
  });

  vi.stubGlobal('fetch', impl);
  return calls;
}

/** A structured-output reply: the JSON arrives as the text block, after any (empty) thinking block. */
function jsonReply(value: unknown) {
  return { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(value) }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AnthropicAiProvider', () => {
  /**
   * Current models reject a forced tool_choice with a 400, so the draft's
   * shape is held by structured output instead — and no tool_choice at all.
   */
  it('sends the description and asks for the draft as structured JSON', async () => {
    const calls = mockFetch([
      {
        json: jsonReply({
          questions: [
            {
              prompt: 'What is your budget?',
              kind: 'single_choice',
              required: true,
              options: [
                { label: 'Over €500', outcomePathType: 'meeting' },
                { label: 'Under €500', outcomePathType: 'other' },
              ],
            },
          ],
          otherPathMessage: 'Not quite the right time yet.',
        }),
      },
    ]);

    const provider = new AnthropicAiProvider('test-key');
    const draft = await provider.draftIntake({ description: 'I coach founders.' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const body = calls[0]!.body as {
      tool_choice?: unknown;
      tools?: unknown;
      output_config: { format: { type: string; schema: { required: string[]; additionalProperties: boolean } } };
      messages: Array<{ content: string }>;
    };
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.required).toEqual(['questions', 'otherPathMessage']);
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect(body.messages[0]!.content).toContain('I coach founders.');

    expect(draft.questions).toHaveLength(1);
    expect(draft.questions[0]!.options).toEqual([
      { label: 'Over €500', outcomePathType: 'meeting' },
      { label: 'Under €500', outcomePathType: 'other' },
    ]);
    expect(draft.otherPathMessage).toBe('Not quite the right time yet.');
  });

  it('puts the service context ahead of the description when given', async () => {
    const calls = mockFetch([
      { json: jsonReply({ questions: [{ prompt: 'X?', kind: 'text', required: true, options: [] }] }) },
    ]);

    await new AnthropicAiProvider('k').draftIntake({
      description: 'Only serious buyers.',
      serviceContext: { name: 'Discovery call', description: 'A free 30-minute chat' },
    });

    const body = calls[0]!.body as { messages: Array<{ content: string }> };
    expect(body.messages[0]!.content).toContain('Discovery call');
    expect(body.messages[0]!.content).toContain('Only serious buyers.');
  });

  it('forces a yes_no question to exactly Yes/No labels regardless of model output', async () => {
    mockFetch([
      {
        json: jsonReply({
          questions: [
            {
              prompt: 'Ready now?',
              kind: 'yes_no',
              required: true,
              options: [
                { label: 'Sure am', outcomePathType: 'meeting' },
                { label: 'Not really', outcomePathType: 'other' },
              ],
            },
          ],
        }),
      },
    ]);

    const draft = await new AnthropicAiProvider('k').draftIntake({ description: 'x' });
    expect(draft.questions[0]!.options).toEqual([
      { label: 'Yes', outcomePathType: 'meeting' },
      { label: 'No', outcomePathType: 'other' },
    ]);
  });

  it('drops a single_choice question with fewer than two usable options', async () => {
    mockFetch([
      {
        json: jsonReply({
          questions: [
            { prompt: 'Only one?', kind: 'single_choice', required: true, options: [{ label: 'A', outcomePathType: 'meeting' }] },
            { prompt: 'Fine one', kind: 'text', required: true, options: [] },
          ],
        }),
      },
    ]);

    const draft = await new AnthropicAiProvider('k').draftIntake({ description: 'x' });
    expect(draft.questions).toHaveLength(1);
    expect(draft.questions[0]!.prompt).toBe('Fine one');
  });

  it('throws AiUnavailableError when every drafted question is unusable', async () => {
    mockFetch([{ json: jsonReply({ questions: [{ prompt: '', kind: 'text', required: true, options: [] }] }) }]);
    await expect(new AnthropicAiProvider('k').draftIntake({ description: 'x' })).rejects.toThrow(
      AiUnavailableError,
    );
  });

  it('throws AiUnavailableError on a non-2xx response, without leaking the body', async () => {
    mockFetch([{ status: 429, text: 'rate limited, key sk-abc123' }]);
    try {
      await new AnthropicAiProvider('k').draftIntake({ description: 'x' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AiUnavailableError);
      expect((error as AiUnavailableError).status).toBe(429);
      expect((error as Error).message).not.toContain('sk-abc123');
    }
  });

  /**
   * A refusal is an HTTP 200 with no draft in it, so nothing distinguishes it
   * from any other empty reply except stop_reason. Reading content first and
   * finding nothing would blame the assistant for returning nothing useful,
   * when in fact it declined — which an admin can act on, by rewording.
   */
  it('reports a refusal as a refusal, not as an unusable draft', async () => {
    mockFetch([{ json: { stop_reason: 'refusal', content: [] } }]);

    await expect(
      new AnthropicAiProvider('key').draftIntake({ description: 'anything' }),
    ).rejects.toThrow(/declined/i);
  });

  it('asks for a server-side fallback, so a refusal is retried before it reaches us', async () => {
    const calls = mockFetch([{ json: jsonReply({ questions: [], otherPathMessage: 'x' }) }]);

    await new AnthropicAiProvider('key')
      .draftIntake({ description: 'a coaching business' })
      .catch(() => undefined);

    const { headers, body } = calls[0]!;
    expect(headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect((body as { fallbacks: string }).fallbacks).toBe('default');
  });

  /**
   * The model reasons before it answers and both come out of max_tokens, so
   * a budget sized around the draft alone truncates before the draft exists.
   * Not a number to tune casually.
   */
  it('leaves room for the model to think as well as answer', async () => {
    const calls = mockFetch([{ json: jsonReply({ questions: [], otherPathMessage: 'x' }) }]);

    await new AnthropicAiProvider('key')
      .draftIntake({ description: 'a coaching business' })
      .catch(() => undefined);

    const body = calls[0]!.body as { model: string; max_tokens: number; thinking?: unknown };
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.max_tokens).toBeGreaterThanOrEqual(8000);
    // Left at the model's default: the reasoning is what is paid for.
    expect(body.thinking).toBeUndefined();
  });

  it('throws AiUnavailableError when the reply is not JSON (cut off, or plain words)', async () => {
    mockFetch([{ json: { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"questions": [{"prom' }] } }]);
    await expect(new AnthropicAiProvider('k').draftIntake({ description: 'x' })).rejects.toThrow(
      AiUnavailableError,
    );
    mockFetch([{ json: { content: [{ type: 'text', text: 'I refuse.' }] } }]);
    await expect(new AnthropicAiProvider('k').draftIntake({ description: 'x' })).rejects.toThrow(
      AiUnavailableError,
    );
  });

  it('writes a Reports summary from structured JSON, with no forced tool', async () => {
    const calls = mockFetch([
      {
        json: jsonReply({
          headline: 'A steady month: 12 sessions, up from 9.',
          points: [{ title: 'Open Tuesday evenings', detail: 'They filled every week.', where: 'week' }],
        }),
      },
    ]);

    const summary = await new AnthropicAiProvider('k').summariseReport({
      businessName: 'Test practice',
      periodLabel: 'September 2026',
      facts: {},
    } as Parameters<AnthropicAiProvider['summariseReport']>[0]);

    const body = calls[0]!.body as { tool_choice?: unknown; output_config: { format: { type: string } } };
    expect(body.tool_choice).toBeUndefined();
    expect(body.output_config.format.type).toBe('json_schema');
    expect(summary.headline).toContain('12 sessions');
    expect(summary.points[0]!.where).toBe('week');
  });

  it('throws AiUnavailableError when fetch itself rejects (network failure)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    await expect(new AnthropicAiProvider('k').draftIntake({ description: 'x' })).rejects.toThrow(
      AiUnavailableError,
    );
  });
});
