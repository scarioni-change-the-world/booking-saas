import { AnthropicAiProvider } from './anthropic';
import { AiUnavailableError, type AiProvider } from './provider';

export * from './provider';
export { AnthropicAiProvider } from './anthropic';

/**
 * Resolve the AI provider from environment configuration.
 *
 * Throws rather than falling back to a silent no-op provider — same
 * reasoning as the calendar module's providerForTenant: an admin clicking
 * "Generate" needs to be told AI assistance isn't configured, not shown an
 * empty draft that reads as "the assistant had no ideas."
 */
export function aiProvider(): AiProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiUnavailableError(
      'AI-assisted setup is not configured for this project yet.',
    );
  }
  return new AnthropicAiProvider(apiKey);
}
