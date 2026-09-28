import 'server-only';

/**
 * KAN-44 — the ONE place a Claude API client is constructed, kept apart
 * from `claude-provider.ts`'s grading logic on purpose. Everything the
 * provider needs from a client is `messages.create`, which
 * `@anthropic-ai/sdk`'s `Anthropic` and Google Vertex AI's `AnthropicVertex`
 * (`@anthropic-ai/vertex-sdk`) both expose with the same request/response
 * shape. Pointing grading at Vertex later — for EU data residency at
 * launch, see the ticket's compliance section — is therefore: write an
 * `createAnthropicVertexClient()` next to this function, pass it to
 * `createClaudeGradingProvider()` from `provider-factory.ts`. The prompt,
 * schema, error mapping and cost code in `claude-provider.ts` don't change.
 *
 * Deliberately NOT in here: anything about the request itself, including
 * `maxRetries` and `timeout`. Those are per-request options in
 * `claude-provider.ts`, so they apply to whichever client is injected — a
 * Vertex client constructed here later can't silently come back with the
 * SDK's default of two retries (see the provider's own comment for why that
 * matters).
 *
 * `ANTHROPIC_API_KEY` is read when a client is BUILT, and a client is only
 * built inside `grade()` — never at import time. `provider-factory.ts`
 * imports this module unconditionally, and every local dev machine and this
 * repo's CI has no key configured, so importing must not throw.
 */
import Anthropic from '@anthropic-ai/sdk';
import { GradingProviderError } from '../provider';

/** The slice of a client `claude-provider.ts` depends on — satisfied by the direct API client and by the Vertex one. */
export type ClaudeMessagesClient = Pick<Anthropic, 'messages'>;

export type ClaudeClientFactory = () => ClaudeMessagesClient;

export function createAnthropicApiClient(): ClaudeMessagesClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new GradingProviderError('ANTHROPIC_API_KEY is not set — see website/.env.example');
  }
  return new Anthropic({ apiKey });
}
