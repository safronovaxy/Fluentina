import 'server-only';

/**
 * KAN-44 — the structured-outputs `output_config.format` for grading,
 * derived from `providerGradingResponseSchema` rather than written out a
 * second time, so the wire schema and the validator that runs on the
 * response can never describe different shapes.
 *
 * Two things this file exists to get right, both found by running the
 * obvious approach rather than assuming it:
 *
 * - The SDK's own `zodOutputFormat()` only accepts zod v4 schemas; this
 *   codebase's contracts are zod v3 (`lib/contracts/grading.ts`), and
 *   passing one throws at runtime ("Cannot read properties of undefined
 *   (reading 'def')") — not a type error, so a mocked test wouldn't notice.
 *   `zod-to-json-schema` is the v3 counterpart. Migrating the contract to v4
 *   for this would ripple through the orchestrator's `ZodError`
 *   classification and every schema consumer, which is not this story's call.
 * - The SDK's schema transformer (`jsonSchemaOutputFormat`) also folds
 *   `enum` into a description string, dropping the API-enforced constraint
 *   on `dimension` and `severity`. Structured outputs DO support `enum`
 *   (Structured outputs docs, "JSON Schema limitations"), so this strips
 *   only the keywords that page lists as unsupported and keeps the rest.
 *
 * The Structured outputs docs' "Not supported" list is the source for what
 * is stripped, and they say an unsupported keyword is rejected rather than
 * ignored, so stripping is treated as required, not cosmetic. That rejection
 * has NOT been observed against a live response — nothing has been sent to
 * the real API yet. Stripped constraints are appended
 * to the field's `description` so the model still sees, e.g., "maxLength
 * 1000" — but they are enforced by `providerGradingResponseSchema.parse` in
 * the provider, not by the API.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { providerGradingResponseSchema } from '@/lib/contracts/grading';

type JsonObject = Record<string, unknown>;

/** Keywords Structured outputs rejects with a 400 ("Not supported" list). `minItems` is handled separately: 0 and 1 are allowed. */
const UNSUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
]);

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Exported for its own unit test — the `properties` branch below is not exercised by the grading schema itself. */
export function sanitiseSchemaForStructuredOutputs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitiseSchemaForStructuredOutputs);
  if (!isJsonObject(node)) return node;

  const out: JsonObject = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema') continue;
    if (UNSUPPORTED_KEYWORDS.has(key) || (key === 'minItems' && typeof value === 'number' && value > 1)) {
      removed.push(`${key} ${String(value)}`);
      continue;
    }
    if (key === 'properties' && isJsonObject(value)) {
      // Keys here are FIELD NAMES, not keywords — only the values are schemas.
      out[key] = Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, sanitiseSchemaForStructuredOutputs(schema)]));
      continue;
    }
    out[key] = sanitiseSchemaForStructuredOutputs(value);
  }
  if (removed.length > 0) {
    const existing = typeof out.description === 'string' ? `${out.description} ` : '';
    out.description = `${existing}(${removed.join(', ')})`;
  }
  return out;
}

let cached: Anthropic.Messages.JSONOutputFormat | undefined;

/** Built once, on first use — not at import time. */
export function gradingOutputFormat(): Anthropic.Messages.JSONOutputFormat {
  cached ??= {
    type: 'json_schema',
    schema: sanitiseSchemaForStructuredOutputs(
      zodToJsonSchema(providerGradingResponseSchema, { target: 'jsonSchema7', $refStrategy: 'none' }),
    ) as JsonObject,
  };
  return cached;
}
